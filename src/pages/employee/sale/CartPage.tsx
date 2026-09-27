import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import QuantityCounter from "@/components/ui/QuantityCounter";
import { useCartStore } from "@/stores/cartStore";
import { useSalesStore } from "@/stores/salesStore";
import { useAuthStore } from "@/stores/authStore";
import { formatCurrency, getCreditHealth, getCreditHealthColor } from "@/lib/formatters";
import { Plus, AlertTriangle } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { useShellBase } from "@/lib/useShellBase";
import { useT } from "@/lib/i18n";
import { useProductsStore } from "@/stores/productsStore";
import ScanButton from "@/components/ui/ScanButton";
import { checkAndNotifyLowStock } from "@/lib/notifications";
import { useCustomersStore } from "@/stores/customersStore";
import { hasPermission } from "@/lib/tenantContext";

export default function CartPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const t = useT();
  const { customer, items, updateQty, removeItem, subtotal, clearCart, setCustomer } = useCartStore();
  const { addToast } = useUIStore();
  const createSale = useSalesStore((s) => s.createSale);
  const setCreditLimit = useCustomersStore((s) => s.setCreditLimit);
  const { user } = useAuthStore();

  const [paymentType, setPaymentType] = useState<"full" | "partial">("full");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank_transfer">("cash");
  const [amountReceived, setAmountReceived] = useState("");
  const [limitDraft, setLimitDraft] = useState("");
  const [savingLimit, setSavingLimit] = useState(false);
  const [amountTouched, setAmountTouched] = useState(false);
  const [dueDate, setDueDate] = useState(customer?.dueDate ?? "");
  const [completing, setCompleting] = useState(false);
  const completingRef = useRef(false);
  // One key per logical attempt. The database claims it (0134), so a double tap or
  // a retry after a lost response returns the sale that already exists instead of
  // charging the customer twice. Retired on success, kept on failure.
  const submissionKeyRef = useRef<string | null>(null);

  // Show cart even without customer — user can scan products first, select customer later

  // PRD §38.3: When last item is removed, redirect to product selection
  // Skip redirect while completing sale to avoid overriding success navigation
  // Use useEffect to avoid race condition with Zustand store sync
  useEffect(() => {
    if (items.length === 0 && !completingRef.current) {
      navigate(`${base}/sale/products`, { replace: true });
    }
  }, [items.length, base, navigate]);

  // While redirecting, render nothing
  if (items.length === 0 && !completingRef.current) return null;

  const total = subtotal();
  const parsedAmount = amountReceived === "" ? null : Number(amountReceived);
  const amountPaid = paymentType === "full" ? total : Math.min(parsedAmount ?? 0, total);
  const creditAfterSale = (customer?.outstandingBalance ?? 0) + (paymentType === "full" ? 0 : total - amountPaid);
  const creditHealth = customer ? getCreditHealth(creditAfterSale, customer.creditLimit) : "good" as const;
  const creditOverLimit = customer ? customer.creditLimit > 0 && creditAfterSale > customer.creditLimit : false;

  // Credit lifecycle enforcement flags
  const hasCreditPortion = paymentType === "partial" && total - amountPaid > 0;
  const creditLimitNotSet = hasCreditPortion && customer && customer.creditLimit <= 0;
  const dueDateNotSet = hasCreditPortion && !dueDate;
  const creditSaleBlocked = hasCreditPortion && (creditLimitNotSet || dueDateNotSet || creditOverLimit);
  // Cash or bank is only a question once money is actually changing hands. On a credit sale with
  // nothing entered yet, no payment has happened, so asking "how was it paid" is a question with
  // no answer — it appears the moment an amount is typed. Full payment always receives money.
  const showPaymentMethod = amountPaid > 0;
  const canEditCustomers = hasPermission("customers.edit");

  async function handleSetCreditLimit() {
    if (!customer || savingLimit) return;
    const value = Number(limitDraft);
    if (!limitDraft.trim() || Number.isNaN(value) || value <= 0) {
      addToast(t("sale.creditLimitFailed"), "warning");
      return;
    }
    setSavingLimit(true);
    try {
      const applied = await setCreditLimit(customer.id, value);
      // The cart holds its own copy of the customer for the sale, so it is updated too —
      // otherwise the credit-health line and the block on Complete still read the old limit.
      setCustomer({ ...customer, creditLimit: applied });
      setLimitDraft("");
      addToast(t("sale.creditLimitSet", { amount: formatCurrency(applied) }), "success");
    } catch (e) {
      addToast(e instanceof Error ? e.message : t("sale.creditLimitFailed"), "error");
    } finally {
      setSavingLimit(false);
    }
  }

  async function handleCompleteSale() {
    if (completingRef.current) return;
    if (!items.length) { addToast(t("sale.addAtLeastOne"), "warning"); return; }
    if (!customer) { addToast(t("sale.selectCustomerFirst"), "warning"); navigate(`${base}/sale`, { state: { fromCart: true } }); return; }
    if (paymentType === "partial" && amountTouched && parsedAmount !== null && parsedAmount < 0) { addToast(t("sale.amountCannotBeNegative"), "warning"); return; }

    completingRef.current = true;
    if (!submissionKeyRef.current) submissionKeyRef.current = crypto.randomUUID();
    setCompleting(true);
    try {
      const outstandingBalance = total - amountPaid;
      const sale = await createSale({
        idempotencyKey: submissionKeyRef.current,
        dueDate: dueDate || undefined,
        customerId: customer!.id,
        customerName: customer!.name,
        customerPhone: customer!.phone,
        customerAddress: customer!.address,
        employeeId: user?.id ?? "",
        employeeName: user?.name ?? t("employees.active"),
        items: items.map((it) => ({
          productId: it.productId,
          productName: it.productName,
          variantId: it.variantId,
          variantName: it.variantName,
          qty: it.qty,
          unitPrice: it.unitPrice,
          unitSize: it.unitSize,
          baseUnit: it.baseUnit,
          lineTotal: it.lineTotal,
        })),
        subtotal: total,
        taxAmount: 0,
        totalAmount: total,
        amountPaid,
        outstandingBalance,
        paymentMethod,
        paymentType,
      });
      // Check for low stock after sale — a per-VARIANT condition, because that is
      // the level sales deduct from. The store still holds pre-sale quantities, so
      // subtract what this sale took, once per variant (never once per line).
      const products = useProductsStore.getState().products;
      const soldByVariant = new Map<string, number>();
      for (const it of items) {
        if (!it.variantId) continue;
        soldByVariant.set(it.variantId, (soldByVariant.get(it.variantId) ?? 0) + it.qty);
      }
      for (const [variantId, soldQty] of soldByVariant) {
        const product = products.find((p) => p.variants.some((v) => v.id === variantId));
        const variant = product?.variants.find((v) => v.id === variantId);
        if (product && variant) {
          checkAndNotifyLowStock(product.id, product.name, variant.stockQty - soldQty, variant.lowStockThreshold);
        }
      }
      // Due date is now persisted atomically inside the create_sale RPC.
      // Navigate first, then clear cart — clearing first causes the <Navigate>
      // guard in this component to fire and redirect away from the success page.
      submissionKeyRef.current = null;
      navigate(`${base}/sale/success`, { state: { sale }, replace: true });
      clearCart();
    } catch (e) {
      completingRef.current = false;
      addToast(e instanceof Error ? e.message : t("sale.failedToComplete"), "error");
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className="flex flex-col bg-background w-full min-h-full">
      <StatusBar />
      <NavHeader title={t("sale.reviewPayment")} />

      {/* Customer strip — two states */}
      {!customer ? (
        <button
          onClick={() => navigate(`${base}/sale`, { state: { fromCart: true } })}
          className="mx-4 mt-3 rounded-[var(--radius-tile)] p-4 flex items-center justify-between transition-opacity active:opacity-70"
          style={{ background: "var(--surface-2)", border: "1.5px dashed var(--divider)" }}
        >
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-full flex items-center justify-center" style={{ background: "var(--muted)" }}>
              <Plus size={18} style={{ color: "var(--text-secondary)" }} />
            </div>
            <div className="text-start">
              <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{t("sale.selectCustomerPrompt")}</p>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("sale.requiredBeforeSale")}</p>
            </div>
          </div>
          <span className="text-xs font-semibold" style={{ color: "var(--brand-dark)" }}>{t("sale.choose")}</span>
        </button>
      ) : (
        <>
          <div className="mx-4 mt-3 bg-muted rounded-[var(--radius-tile)] p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-foreground">{customer.name}</p>
              <span className="text-xs" style={{ color: getCreditHealthColor(creditHealth) }}>
                {t("sale.creditHealth")}: {creditHealth === "good" ? t("sale.good") : creditHealth === "warning" ? t("sale.warning") : t("sale.overLimit")}
              </span>
            </div>
            <div className="flex gap-8">
              <div>
                <p className="ds-section-label text-caption">{t("sale.outstandingCredit")}</p>
                <p className="text-sm font-bold text-foreground">{formatCurrency(customer.outstandingBalance)}</p>
              </div>
              <div>
                <p className="ds-section-label text-caption">{t("customers.creditLimit")}</p>
                <p className="text-sm font-bold text-foreground">{formatCurrency(customer.creditLimit)}</p>
              </div>
            </div>
          </div>
          {creditOverLimit && (
            <div
              className="mx-4 mt-2 rounded-[var(--radius-tile)] p-3"
              style={{ background: "var(--error-bg)", border: "1px solid var(--error-border)" }}
            >
              <p className="text-xs font-medium" style={{ color: "var(--error)" }}>
                <AlertTriangle size={13} className="inline-block me-1 align-[-2px]" />
                {t("sale.willExceedLimit").replace("{name}", customer.name)}
              </p>
            </div>
          )}
        </>
      )}

      {/* Cart items */}
      <div className="px-4 pt-4">
        <div className="flex flex-col">
            {items.map((item, i) => (
              <div key={item.variantId} className={`py-4 ${i < items.length - 1 ? "border-b border-border" : ""}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="text-sm font-bold text-foreground">{item.productName}</p>
                    <p className="text-xs text-caption">
                      {item.variantName} · {formatCurrency(item.unitPrice)} × {item.qty}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-bold text-foreground">{formatCurrency(item.lineTotal)}</p>
                    <QuantityCounter
                      qty={item.qty}
                      onChange={(q) => updateQty(item.variantId, q)}
                      max={item.maxQty}
                      step={item.qtyStep}
                      deleteOnOne
                      onDelete={() => removeItem(item.variantId)}
                      size="sm"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

        <div className="flex gap-2 mt-3">
          <button
            onClick={() => navigate(`${base}/sale/products`)}
            className="flex-1 h-12 rounded-[var(--radius-tile)] border border-border-control flex items-center justify-center gap-2 text-sm font-medium text-foreground"
          >
            <Plus size={16} />
            {t("sale.addMore")}
          </button>
          <ScanButton
            onScan={(code) => {
              const product = useProductsStore.getState().findByBarcode(code);
              if (!product) {
                addToast(t("sale.noProductForBarcode", { code }), "error");
                return;
              }
              if (product.stockQty <= 0) {
                addToast(t("sale.productOutOfStock", { name: product.name }), "warning");
                return;
              }
              // A variant is sellable when ITS OWN stock of record is positive.
              const inStock = product.variants.filter((v) => v.stockQty > 0);
              if (inStock.length === 0) {
                addToast(t("sale.productOutOfStock", { name: product.name }), "warning");
                return;
              }
              if (inStock.length === 1) {
                const v = inStock[0];
                const step = v.qtyStep > 0 ? v.qtyStep : 1;
                const maxU = Math.floor(v.stockQty / step) * step;
                useCartStore.getState().addItem({
                  productId: product.id,
                  productName: product.name,
                  variantId: v.id,
                  variantName: v.name,
                  qty: v.qtyStep,
                  unitPrice: v.sellingPrice,
                  lineTotal: v.sellingPrice * v.qtyStep,
                  maxQty: maxU,
                  qtyStep: v.qtyStep,
                  unitSize: v.unitSize,
                  baseUnit: product.baseUnit,
                });
                addToast(`${product.name} (${v.name}) added`, "success");
              } else {
                navigate(`${base}/sale/products/${product.id}`);
              }
            }}
            label={t("scan")}
            size="lg"
          />
        </div>
      </div>

      {/* Payment type */}
      <div className="px-4 pt-5">
        <p className="ds-section-label text-foreground mb-3">{t("sale.paymentType")}</p>
        <div className="flex gap-2">
          {[{ key: "full", labelKey: "sale.fullPayment" }, { key: "partial", labelKey: "sale.partialCredit" }].map((opt) => (
            <button
              key={opt.key}
              onClick={() => setPaymentType(opt.key as "full" | "partial")}
              className={`flex-1 h-11 rounded-full text-sm font-medium transition-colors ${
                paymentType === opt.key ? "bg-ink text-ink-fg" : "border border-border text-foreground"
              }`}
            >
              {t(opt.labelKey as any)}
            </button>
          ))}
        </div>
      </div>

      {/* Payment method — moved from SaleReviewPage, and now only asked once there is money to
          account for. */}
      {showPaymentMethod && (
        <div className="px-4 pt-4">
          <p className="ds-section-label text-foreground mb-3">{t("sale.paymentMethod")}</p>
          <div className="flex gap-2">
            {[{ key: "cash", labelKey: "sale.cash" }, { key: "bank_transfer", labelKey: "sale.bankTransfer" }].map((opt) => (
              <button
                key={opt.key}
                onClick={() => setPaymentMethod(opt.key as "cash" | "bank_transfer")}
                className={`flex-1 h-11 rounded-full text-sm font-medium transition-colors ${
                  paymentMethod === opt.key ? "bg-ink text-ink-fg" : "border border-border text-foreground"
                }`}
              >
                {t(opt.labelKey as any)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Amount received for partial */}
      {paymentType === "partial" && (
        <div className="px-4 pt-4">
          <p className="ds-section-label text-foreground mb-2">{t("sale.amountReceived")}</p>
          <input
            type="number"
            inputMode="numeric"
            value={amountReceived}
            onChange={(e) => setAmountReceived(e.target.value)}
            placeholder={t("sale.enterAmount")}
            className="w-full h-12 rounded-[var(--radius-input)] border border-border px-4 text-sm text-foreground placeholder:text-caption outline-none"
            onFocus={() => setAmountTouched(true)}
          />
          <p className="ds-section-label text-foreground mb-2 mt-4">{t("sale.paymentDueDate")}</p>
          <p className="text-12 text-caption mb-2">{hasCreditPortion ? t("sale.dueDateRequired") : t("sale.dueDateOptional")}</p>
          <input
            type="date"
            value={dueDate}
            min={new Date().toISOString().split('T')[0]}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full outline-none"
          />

          {/* Credit with no limit on the customer used to stop the sale here with a disabled
              button and no way forward. The limit can be set from this screen by whoever holds
              customers.edit; the database enforces the same rule, so hiding it is not the guard. */}
          {creditLimitNotSet && canEditCustomers && (
            <div className="mt-4">
              <p className="ds-section-label text-foreground mb-2">{t("sale.setCreditLimit")}</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  value={limitDraft}
                  onChange={(e) => setLimitDraft(e.target.value)}
                  placeholder={t("sale.enterAmount")}
                  className="flex-1 h-12 rounded-[var(--radius-input)] border border-border px-4 text-sm text-foreground placeholder:text-caption outline-none"
                />
                <button
                  onClick={handleSetCreditLimit}
                  disabled={savingLimit || !limitDraft.trim()}
                  className="h-12 px-5 rounded-full text-sm font-bold transition-opacity active:opacity-80 disabled:opacity-40"
                  style={{ background: "var(--brand)", color: "#0a0a0a" }}
                >
                  {savingLimit ? t("common.loading") : t("common.save")}
                </button>
              </div>
              <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>
                {t("sale.creditLimitHint")}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Summary box */}
      {items.length > 0 && (
        <div
          className="mx-4 mt-5 rounded-[var(--radius-tile)] p-4"
          style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
        >
          <div className="flex justify-between py-1">
            <span className="text-sm text-caption">{t("sale.subtotal")}</span>
            <span className="text-sm font-medium text-foreground">{formatCurrency(total)}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-sm text-caption">{t("sale.paidLabel")}</span>
            <span className="text-sm font-medium text-foreground">{formatCurrency(amountPaid)}</span>
          </div>
          {paymentType === "partial" && amountPaid < total && (
            <div className="flex justify-between py-1">
              <span className="text-sm text-caption">{t("sale.outstanding")}</span>
              <span className="text-sm font-medium" style={{ color: "var(--error)" }}>{formatCurrency(total - amountPaid)}</span>
            </div>
          )}
          <div className="border-t border-border my-2" />
          <div className="flex justify-between py-1">
            <span className="text-sm font-bold text-foreground">{t("sale.totalLabel")}</span>
            <span className="text-sm font-bold text-foreground">{formatCurrency(total)}</span>
          </div>
        </div>
      )}

      {/* Complete Sale — instead of Proceed to Review */}
      <div className="p-4 pb-6">
        {!customer ? (
          <Button
            onClick={() => navigate(`${base}/sale`, { state: { fromCart: true } })}
            className="w-full"
          >
            {t("sale.selectCustomerContinue")}
          </Button>
        ) : (
          <Button
            onClick={handleCompleteSale}
            disabled={completing || items.length === 0 || creditSaleBlocked}
            className="w-full"
          >
            {completing ? t("sale.processing") : creditSaleBlocked && hasCreditPortion
              ? creditLimitNotSet ? t("sale.setCreditLimitFirst") : dueDateNotSet ? t("sale.selectDueDateFirst") : t("sale.overCreditLimit")
              : t("sale.completeSaleWith").replace("{amount}", formatCurrency(total))}
          </Button>
        )}
      </div>
    </div>
  );
}
