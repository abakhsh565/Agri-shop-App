import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import DateField from "@/components/ui/DateField";
import QuantityCounter from "@/components/ui/QuantityCounter";
import RollingNumber from "@/components/ui/RollingNumber";
import { useCartStore } from "@/stores/cartStore";
import { useSalesStore } from "@/stores/salesStore";
import { useAuthStore } from "@/stores/authStore";
import { formatCurrency, getCreditHealth, getCreditHealthColor } from "@/lib/formatters";
import { Plus, AlertTriangle, Clock, X, Percent, Pencil } from "lucide-react";
import Photo from "@/components/ui/Photo";
import Sheet from "@/components/ui/Sheet";
import { useUIStore } from "@/stores/uiStore";
import { useShellBase } from "@/lib/useShellBase";
import { useT } from "@/lib/i18n";
import { useProductsStore } from "@/stores/productsStore";
import ScanButton from "@/components/ui/ScanButton";
import { checkAndNotifyLowStock } from "@/lib/notifications";
import { useCustomersStore } from "@/stores/customersStore";
import { hasPermission } from "@/lib/tenantContext";
import CreditLimitSheet from "@/components/customers/CreditLimitSheet";
import type { LocalCreditRequest } from "@/lib/localGroupRegistry";

export default function CartPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const t = useT();
  const {
    customer,
    items,
    updateQty,
    removeItem,
    subtotal,
    total: cartTotal,
    discount,
    setDiscount,
    setLineDiscount,
    clearCart,
    setCustomer,
  } = useCartStore();
  const { addToast } = useUIStore();
  const createSale = useSalesStore((s) => s.createSale);
  const setCreditLimit = useCustomersStore((s) => s.setCreditLimit);
  const requestCreditLimitIncrease = useCustomersStore((s) => s.requestCreditLimitIncrease);
  const { user } = useAuthStore();

  const [paymentType, setPaymentType] = useState<"full" | "partial">("full");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank_transfer">("cash");
  const [amountReceived, setAmountReceived] = useState("");
  const [savingLimit, setSavingLimit] = useState(false);
  // One sheet, two jobs: `set` writes the limit, `request` asks the owner for one (0251).
  const [limitMode, setLimitMode] = useState<null | "set" | "request">(null);
  // A request already waiting for this customer. The customer card says so, and the sale screen
  // says the same thing: a second request for one decision is not two decisions, it is noise
  // the owner has to clear twice.
  const [pendingLimitRequest, setPendingLimitRequest] = useState<LocalCreditRequest | null>(null);
  const [amountTouched, setAmountTouched] = useState(false);
  const [dueDate, setDueDate] = useState(customer?.dueDate ?? "");
  const [completing, setCompleting] = useState(false);
  const completingRef = useRef(false);
  // One key per logical attempt. The database claims it (0134), so a double tap or
  // a retry after a lost response returns the sale that already exists instead of
  // charging the customer twice. Retired on success, kept on failure.
  const submissionKeyRef = useRef<string | null>(null);

  const customerId = customer?.id ?? null;
  const loadPendingLimitRequest = async () => {
    if (!customerId) { setPendingLimitRequest(null); return; }
    try {
      // On demand, like the customer card: the sale screen must not pull the alerts module
      // into its chunk for a check that is usually a no-op.
      const { getCreditRequestsDB } = await import("@/lib/localGroupRegistry");
      const rows = await getCreditRequestsDB();
      setPendingLimitRequest(rows.find((r) => r.customerId === customerId && r.status === "pending") ?? null);
    } catch {
      // Unreadable: leave the button as it was rather than claiming the request went nowhere.
    }
  };

  useEffect(() => {
    void loadPendingLimitRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the customer in the cart
  }, [customerId]);

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

  const total = cartTotal();
  /**
   * The discount sheet's own state. One sheet for both scopes because the question is the same —
   * how much off, and off what — and because a second screen for "discount this line" would leave
   * the review screen without the number it is about to charge.
   */
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountScope, setDiscountScope] = useState<string>("sale");
  const [discountMode, setDiscountMode] = useState<"percent" | "amount">("percent");
  const [discountValue, setDiscountValue] = useState("");

  const discountLine = items.find((i) => i.variantId === discountScope) ?? null;
  /** What the chosen scope is worth before any discount — a percent is taken against this. */
  const discountBase = discountScope === "sale"
    ? subtotal()
    : discountLine
      ? discountLine.qty * discountLine.unitPrice
      : 0;
  const typedDiscount = Number(discountValue) || 0;
  const discountAmount = Math.max(
    0,
    Math.min(
      discountBase,
      discountMode === "percent" ? (discountBase * typedDiscount) / 100 : typedDiscount,
    ),
  );
  /**
   * A walk-in sale is paid at the counter — there is no account to owe the difference and nobody
   * to remind, so credit is not offered at all until a customer is added. */
  const isWalkIn = !customer;
  const parsedAmount = amountReceived === "" ? null : Number(amountReceived);
  const amountPaid = isWalkIn || paymentType === "full" ? total : Math.min(parsedAmount ?? 0, total);
  const creditAfterSale = (customer?.outstandingBalance ?? 0) + (paymentType === "full" ? 0 : total - amountPaid);
  const creditHealth = customer ? getCreditHealth(creditAfterSale, customer.creditLimit) : "good" as const;
  const creditOverLimit = customer ? customer.creditLimit > 0 && creditAfterSale > customer.creditLimit : false;

  // Credit lifecycle enforcement flags
  const hasCreditPortion = !isWalkIn && paymentType === "partial" && total - amountPaid > 0;
  const creditLimitNotSet = hasCreditPortion && customer && customer.creditLimit <= 0;
  const dueDateNotSet = hasCreditPortion && !dueDate;
  const creditSaleBlocked = hasCreditPortion && (creditLimitNotSet || dueDateNotSet || creditOverLimit);
  // Cash or bank is only a question once money is actually changing hands. On a credit sale with
  // nothing entered yet, no payment has happened, so asking "how was it paid" is a question with
  // no answer — it appears the moment an amount is typed. Full payment always receives money.
  const showPaymentMethod = amountPaid > 0;
  const canSetCreditLimit = hasPermission("customers.credit_limit");

  async function handleSaveCreditLimit(value: number, reason: string) {
    if (!customer || savingLimit) return;
    if (!Number.isFinite(value) || value <= 0) {
      addToast(t("sale.creditLimitFailed"), "warning");
      return;
    }
    setSavingLimit(true);
    try {
      if (canSetCreditLimit) {
        const applied = await setCreditLimit(customer.id, value);
        // The cart holds its own copy of the customer for the sale, so it is updated too —
        // otherwise the credit-health line and the block on Complete still read the old limit.
        setCustomer({ ...customer, creditLimit: applied });
        addToast(t("sale.creditLimitSet", { amount: formatCurrency(applied) }), "success");
      } else {
        // Without the lending permission the number is a proposal, not a write — the owner
        // approves (and may change) it before it becomes the customer's limit.
        await requestCreditLimitIncrease({
          customerId: customer.id,
          customerName: customer.name,
          currentLimit: customer.creditLimit,
          requestedLimit: value,
          requestedBy: user?.name || user?.id || "",
          reason,
        });
        addToast(t("creditLimit.requestSent"), "success");
        await loadPendingLimitRequest();
      }
      setLimitMode(null);
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : canSetCreditLimit ? t("sale.creditLimitFailed") : t("creditLimit.requestFailed"),
        "error",
      );
    } finally {
      setSavingLimit(false);
    }
  }

  async function handleCompleteSale() {
    if (completingRef.current) return;
    if (!items.length) { addToast(t("sale.addAtLeastOne"), "warning"); return; }
    // No customer is a walk-in, not a missing step: it completes as a paid sale. Credit is the
    // only thing that needs the account, and the payment-type control that offers it is not drawn
    // when the cart has no customer.
    if (paymentType === "partial" && amountTouched && parsedAmount !== null && parsedAmount < 0) { addToast(t("sale.amountCannotBeNegative"), "warning"); return; }

    completingRef.current = true;
    if (!submissionKeyRef.current) submissionKeyRef.current = crypto.randomUUID();
    setCompleting(true);
    try {
      const outstandingBalance = total - amountPaid;
      const sale = await createSale({
        // A walk-in has no account: the sale is stored with no customer id, and the name is the
        // label the till prints, not a record the shop can chase for money.
        idempotencyKey: submissionKeyRef.current,
        dueDate: isWalkIn ? undefined : dueDate || undefined,
        customerId: customer?.id ?? "",
        customerName: customer?.name ?? t("sale.walkIn"),
        customerPhone: customer?.phone,
        customerAddress: customer?.address,
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
          discount: it.discount ?? 0,
        })),
        subtotal: total + discount,
        taxAmount: 0,
        totalAmount: total,
        discount,
        amountPaid,
        outstandingBalance,
        paymentMethod,
        paymentType: isWalkIn ? "full" : paymentType,
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
          // The level before this sale is what lets "only when it crosses the line" mean
          // what it says: selling ten packs in an afternoon crosses once, and the shop is
          // told once. Without it the rule could only guess at a crossing.
          checkAndNotifyLowStock(
            product.id,
            product.name,
            variant.stockQty - soldQty,
            variant.lowStockThreshold,
            variant.stockQty,
          );
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

      {/* The credit limit is asked for above the customer it belongs to, not inside the payment
          section: it is a property of this customer, and it is needed whether the sale in front
          of you is credit or not. */}
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
              {/* No customer is a sale, not a missing step: it completes as a walk-in, paid at the
                  counter. A customer is only needed when the sale turns into credit. */}
              <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{t("sale.walkIn")}</p>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("sale.walkInHint")}</p>
            </div>
          </div>
          <span className="text-xs font-semibold" style={{ color: "var(--brand-dark)" }}>{t("sale.addCustomer")}</span>
        </button>
      ) : (
        <>
          <div className="mx-4 mt-3 bg-muted rounded-[var(--radius-tile)] p-4">
            {/* The person this sale belongs to, with the two things that can change it: swap and
                remove. Removing a customer does not cancel the sale — it makes it a walk-in,
                which is what a customer added by mistake actually is (owner, 2026-11-17). */}
            <div className="flex items-center gap-3 mb-3">
              <div className="size-10 rounded-full overflow-hidden shrink-0 flex items-center justify-center text-sm font-bold" style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}>
                <Photo
                  src={customer.imageUrl}
                  alt={customer.name}
                  className="w-full h-full object-cover"
                  fallback={customer.name.charAt(0).toUpperCase()}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground truncate">{customer.name}</p>
                <p className="text-xs" style={{ color: getCreditHealthColor(creditHealth) }}>
                  {t("sale.creditHealth")}: {creditHealth === "good" ? t("sale.good") : creditHealth === "warning" ? t("sale.warning") : t("sale.overLimit")}
                </p>
              </div>
              {/* Swap the customer. The word "Change" is gone and a pencil stands in its place
                  (owner, 2026-11-17): the row already says whose sale this is, so the only thing
                  the reader needs from this control is "this is the editable part". */}
              <button
                type="button"
                onClick={() => navigate(`${base}/sale`, { state: { fromCart: true } })}
                aria-label={t("common.change")}
                title={t("common.change")}
                className="size-8 rounded-full flex items-center justify-center shrink-0"
                style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--divider)" }}
                data-testid="sale-change-customer"
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                onClick={() => setCustomer(null)}
                aria-label={t("sale.removeCustomer")}
                className="size-8 rounded-full flex items-center justify-center shrink-0"
                style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                data-testid="sale-remove-customer"
              >
                <X size={15} />
              </button>
            </div>
            <div className="flex gap-8">
              <div>
                <p className="ds-section-label text-caption">{t("sale.outstandingCredit")}</p>
                <p className="text-sm font-bold text-foreground">{formatCurrency(customer.outstandingBalance)}</p>
              </div>
              {/* The limit and the way to change it are one control: the number, then the
                  action, named for what it will do — "Set limit" when there is none,
                  "Change limit" when there is. It used to float above the customer as a bare
                  underlined "Credit Limit", which read as a heading, not a button. */}
              <div>
                <p className="ds-section-label text-caption">{t("customers.creditLimit")}</p>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-foreground">
                    {customer.creditLimit > 0 ? formatCurrency(customer.creditLimit) : "\u2014"}
                  </p>
                  {/* While a request is waiting, the employee is told so instead of being
                      offered a second one; the owner keeps their own direct action. */}
                  {!canSetCreditLimit && pendingLimitRequest ? (
                    <span
                      className="text-11 flex items-center gap-1"
                      style={{ color: "var(--text-secondary)" }}
                      data-testid="credit-limit-pending"
                    >
                      <Clock size={12} className="shrink-0" />
                      {t("creditLimit.requestPending")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setLimitMode(canSetCreditLimit ? "set" : "request")}
                      className="text-12 font-semibold px-2.5 py-1 rounded-full"
                      style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--divider)" }}
                    >
                      {canSetCreditLimit
                        ? (customer.creditLimit > 0 ? t("customers.changeLimit") : t("customers.setLimit"))
                        : t("creditLimit.requestShort")}
                    </button>
                  )}
                </div>
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
                      {item.discount ? ` · −${formatCurrency(item.discount)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-bold text-foreground">
                      <RollingNumber value={item.lineTotal} format={formatCurrency} />
                    </p>
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

      {/* Payment type — only when there is an account: a walk-in is paid in full by definition. */}
      {!isWalkIn && (
      <div className="px-4 pt-5">
        <p className="ds-section-label text-foreground mb-3">{t("sale.paymentType")}</p>
        <div className="flex gap-2">
          {[{ key: "full", labelKey: "sale.fullPayment" }, { key: "partial", labelKey: "sale.partialCredit" }].map((opt) => (
            <button
              key={opt.key}
              onClick={() => setPaymentType(opt.key as "full" | "partial")}
              aria-pressed={paymentType === opt.key}
              /*
               * A chosen option is green text in a green outline, not a filled plate. Filled
               * controls here were the loudest thing above the sale's own total: two of them read
               * as two primary actions, and on the dark theme they were solid black-on-black.
               * Selection still has to be obvious at a glance, so the outline carries it.
               */
              className="flex-1 h-11 rounded-full text-sm font-medium transition-colors ds-pressable"
              style={{
                border: `1px solid ${paymentType === opt.key ? "var(--brand-dark)" : "var(--border)"}`,
                color: paymentType === opt.key ? "var(--brand-dark)" : "var(--text-primary)",
                background: "transparent",
              }}
            >
              {t(opt.labelKey as any)}
            </button>
          ))}
        </div>
      </div>
      )}

      {/* Amount received for partial — directly under the payment choice it belongs to, so
          "half now" reads as one decision: how much, then when it is due. */}
      {paymentType === "partial" && (
        <div className="px-4 pt-4">
          <p className="ds-section-label text-foreground mb-2">{t("sale.amountReceived")}</p>
          <input
            type="number"
            inputMode="numeric"
            value={amountReceived}
            onChange={(e) => setAmountReceived(e.target.value)}
            placeholder={t("sale.enterAmount")}
            className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm text-foreground placeholder:text-caption outline-none"
            onFocus={() => setAmountTouched(true)}
          />
          <p className="ds-section-label text-foreground mb-2 mt-4">{t("sale.paymentDueDate")}</p>
          <p className="text-12 text-caption mb-2">{hasCreditPortion ? t("sale.dueDateRequired") : t("sale.dueDateOptional")}</p>
          <DateField
            value={dueDate}
            min={new Date().toISOString().split("T")[0]}
            onChange={setDueDate}
            testId="sale-due-date"
          />

        </div>
      )}

      {/* Payment method — asked once there is money to account for, and after the amount that
          makes it a real question. */}
      {showPaymentMethod && (
        <div className="px-4 pt-4">
          <p className="ds-section-label text-foreground mb-3">{t("sale.paymentMethod")}</p>
          <div className="flex gap-2">
            {[{ key: "cash", labelKey: "sale.cash" }, { key: "bank_transfer", labelKey: "sale.bankTransfer" }].map((opt) => (
              <button
                key={opt.key}
                onClick={() => setPaymentMethod(opt.key as "cash" | "bank_transfer")}
                aria-pressed={paymentMethod === opt.key}
                className="flex-1 h-11 rounded-full text-sm font-medium transition-colors ds-pressable"
                style={{
                  border: `1px solid ${paymentMethod === opt.key ? "var(--brand-dark)" : "var(--border)"}`,
                  color: paymentMethod === opt.key ? "var(--brand-dark)" : "var(--text-primary)",
                  background: "transparent",
                }}
              >
                {t(opt.labelKey as any)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Discount — the one place money comes OFF the sale, so it sits directly above the
          figures it changes rather than inside a menu (owner, 2026-11-17). */}
      <div className="px-4 pt-4">
        <button
          type="button"
          onClick={() => {
            setDiscountScope("sale");
            setDiscountMode("percent");
            setDiscountValue("");
            setDiscountOpen(true);
          }}
          className="w-full h-12 px-4 rounded-[var(--radius-tile)] flex items-center justify-between ds-pressable"
          style={{ background: "var(--tone-card)", border: "1px solid var(--divider)" }}
          data-testid="sale-discount"
        >
          <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            <Percent size={15} />
            {t("sale.discount")}
          </span>
          <span className="text-sm font-semibold" style={{ color: discount > 0 ? "var(--error)" : "var(--brand-dark)" }}>
            {discount > 0 ? `−${formatCurrency(discount)}` : t("sale.addDiscount")}
          </span>
        </button>
      </div>

      {/* Summary box */}
      {items.length > 0 && (
        <div
          className="mx-4 mt-3 rounded-[var(--radius-tile)] p-4"
          style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
        >
          <div className="flex justify-between py-1">
            <span className="text-sm text-caption">{t("sale.subtotal")}</span>
            <span className="text-sm font-medium text-foreground">{formatCurrency(subtotal())}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between py-1">
              <span className="text-sm text-caption">{t("sale.discount")}</span>
              <span className="text-sm font-medium" style={{ color: "var(--error)" }}>−{formatCurrency(discount)}</span>
            </div>
          )}
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
            {/* Changing a line's quantity changes this figure, so it rolls like the stepper's own
                digits: one motion for every number the shopkeeper moves in the same gesture. */}
            <span className="text-sm font-bold text-foreground">
              <RollingNumber value={total} format={formatCurrency} />
            </span>
          </div>
        </div>
      )}

      {/* Complete Sale — instead of Proceed to Review */}
      <div className="p-4 pb-6">
        {/*
         * One button, both cases. It used to be "Select customer & continue" until a customer was
         * chosen, which made a walk-in sale impossible to finish: the goods were on the counter and
         * the till asked for an account. Credit still needs the customer — that is what
         * `creditSaleBlocked` refuses, and it can only be true with a customer in the cart.
         */}
        <Button
          onClick={handleCompleteSale}
          disabled={completing || items.length === 0 || creditSaleBlocked}
          className="w-full"
        >
          {completing ? t("sale.processing") : creditSaleBlocked && hasCreditPortion
            ? creditLimitNotSet ? t("sale.setCreditLimitFirst") : dueDateNotSet ? t("sale.selectDueDateFirst") : t("sale.overCreditLimit")
            : t("sale.completeSaleWith").replace("{amount}", formatCurrency(total))}
        </Button>
      </div>

      {/* Setting a limit is one small decision, so it gets its own sheet instead of a field
          wedged into the payment column — and the sheet is reachable whether or not this sale
          needs credit. Without the lending permission the same sheet files a request instead. */}
      {/* Taking money off: one sheet, two scopes, two ways of typing the same amount. */}
      <Sheet
        open={discountOpen}
        title={t("sale.discount")}
        onClose={() => setDiscountOpen(false)}
      >
        <div className="px-4 flex flex-col gap-4">
          <div>
            <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
              {t("sale.discountScope")}
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setDiscountScope("sale")}
                className="h-11 px-4 rounded-[var(--radius-tile)] text-sm font-medium text-start flex items-center justify-between"
                style={{
                  border: `1px solid ${discountScope === "sale" ? "var(--brand)" : "var(--divider)"}`,
                  color: "var(--text-primary)",
                }}
              >
                <span>{t("sale.wholeSale")}</span>
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{formatCurrency(subtotal())}</span>
              </button>
              {items.map((it) => (
                <button
                  key={it.variantId}
                  type="button"
                  onClick={() => setDiscountScope(it.variantId)}
                  className="h-11 px-4 rounded-[var(--radius-tile)] text-sm font-medium text-start flex items-center justify-between gap-2"
                  style={{
                    border: `1px solid ${discountScope === it.variantId ? "var(--brand)" : "var(--divider)"}`,
                    color: "var(--text-primary)",
                  }}
                >
                  <span className="truncate">{it.productName} · {it.variantName}</span>
                  <span className="text-xs shrink-0" style={{ color: "var(--text-secondary)" }}>
                    {formatCurrency(it.qty * it.unitPrice)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
              {t("sale.discountHow")}
            </p>
            <div className="flex gap-2">
              {(["percent", "amount"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setDiscountMode(kind)}
                  aria-pressed={discountMode === kind}
                  className="flex-1 h-11 rounded-full text-sm font-medium ds-pressable"
                  style={{
                    border: `1px solid ${discountMode === kind ? "var(--brand-dark)" : "var(--border)"}`,
                    color: discountMode === kind ? "var(--brand-dark)" : "var(--text-primary)",
                  }}
                >
                  {kind === "percent" ? t("sale.percentOff") : t("sale.amountOff")}
                </button>
              ))}
            </div>
          </div>

          <div>
            <input
              type="number"
              inputMode="decimal"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              placeholder={discountMode === "percent" ? "0" : "0.00"}
              className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm text-foreground outline-none"
              style={{ border: "1.5px solid var(--brand)" }}
              data-testid="sale-discount-value"
            />
            <div className="flex justify-between mt-2 px-1">
              <span className="text-12" style={{ color: "var(--text-secondary)" }}>{t("sale.discountOff")}</span>
              <span className="text-13 font-bold" style={{ color: "var(--text-primary)" }}>
                {formatCurrency(discountAmount)}
              </span>
            </div>
          </div>

          <div className="flex gap-2 pb-2">
            {(discountScope === "sale" ? discount : discountLine?.discount ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (discountScope === "sale") setDiscount(0);
                  else setLineDiscount(discountScope, 0);
                  setDiscountOpen(false);
                }}
                className="h-12 px-5 rounded-[var(--radius-tile)] text-sm font-semibold"
                style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
              >
                {t("sale.removeDiscount")}
              </button>
            )}
            <div className="flex-1">
              <Button
                fullWidth
                onClick={() => {
                  if (discountScope === "sale") setDiscount(discountAmount);
                  else setLineDiscount(discountScope, discountAmount);
                  setDiscountOpen(false);
                }}
              >
                {t("sale.applyDiscount")}
              </Button>
            </div>
          </div>
        </div>
      </Sheet>

      <CreditLimitSheet
        open={limitMode !== null}
        currentLimit={customer?.creditLimit ?? 0}
        outstanding={customer?.outstandingBalance ?? 0}
        saving={savingLimit}
        mode={limitMode ?? "set"}
        onClose={() => setLimitMode(null)}
        onSave={handleSaveCreditLimit}
      />
    </div>
  );
}
