import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import Button from "@/components/ui/Button";
import Sheet from "@/components/ui/Sheet";
import { SkeletonList } from "@/components/ui/Skeleton";
import SaleReceipt from "@/components/sales/SaleReceipt";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useSalesStore } from "@/stores/salesStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useProductsStore } from "@/stores/productsStore";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { hasPermission } from "@/lib/tenantContext";
import { useShellBase } from "@/lib/useShellBase";
import { supabase } from "@/lib/supabase";
import { ChevronRight, Share2, Wallet, RotateCcw, Trash2, Clock } from "lucide-react";
import type { SaleItem as SaleLine } from "@/types";

/**
 * One sale, read top to bottom in the order a person needs it.
 *
 * This screen is the *record* of a sale, and it is the same record whether the shopkeeper or
 * an employee opens it — so it is one screen. It used to be two (an admin page and an
 * employee page, ~1000 lines between them), which is how they came to disagree: one printed
 * a cost and profit line under every item, the other did not; one showed "Status" with
 * nothing after it, both repeated the totals in a second card and again on the receipt, and
 * neither showed the sale number it was describing.
 *
 * What is on it, and why each thing is:
 *
 *   1. **The state of the sale, if it is not simply completed** — voided, with the reason,
 *      because that used to be local state that only knew about voids performed in the same
 *      session, so an already-voided sale still offered Return and Void.
 *   2. **The receipt** — number, when, customer, phone, payment, items, sold by, and the
 *      amount taken last. The same component the success screen draws, so the two agree.
 *   3. **The customer**, tappable, because the next thought is always "what does this person
 *      still owe me".
 *   4. **What was sold**, with returned quantities marked on the line they belong to.
 *   5. **The shop's own numbers** — cost, profit, margin — kept off the receipt and off the
 *      customer's copy entirely: these are the shopkeeper's figures, and only theirs.
 *   6. **Returns**, each with what came back and what it cost.
 *   7. **The note**, on its own, not wedged into the money.
 *
 * The actions are the four things anyone ever does with a past sale: send it, take a payment
 * against it, return it, or void it — with the most likely one (taking money on a sale that
 * still owes) as the only primary.
 */
export default function SaleDetailView() {
  const { saleId } = useParams();
  const navigate = useNavigate();
  const base = useShellBase();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";

  const sale = useSalesStore((s) => s.sales.find((x) => x.id === saleId));
  // `ready` is what makes it honest to say a sale does not exist: before the store has
  // loaded, a missing sale means "not here yet", not "not found".
  const salesReady = useSalesStore((s) => s.ready);
  const updateNote = useSalesStore((s) => s.updateNote);
  const customers = useCustomersStore((s) => s.customers);
  const products = useProductsStore((s) => s.products);
  const customer = sale?.customerId ? customers.find((c) => c.id === sale.customerId) : null;
  const user = useAuthStore((s) => s.user);
  const { addToast } = useUIStore();

  const isManager = user?.role === "admin" || user?.role === "co_admin";
  const canVoid = isManager && hasPermission("sales.void");

  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const voidingRef = useRef(false);
  const [returns, setReturns] = useState<ReturnRecord[]>([]);

  useEffect(() => {
    if (sale) setNote(sale.note ?? "");
  }, [sale?.id]);

  useEffect(() => {
    if (!saleId) return;
    let active = true;
    async function fetchReturnHistory() {
      try {
        const { data: returnRows } = await supabase
          .from("returns")
          .select("id, return_number, total_refund, resolution, reason, processed_by_name, created_at")
          .eq("sale_id", saleId!)
          .order("created_at", { ascending: false });
        if (!returnRows || returnRows.length === 0) {
          if (active) setReturns([]);
          return;
        }
        const { data: returnItemRows } = await supabase
          .from("return_items")
          .select("return_id, product_name, variant_name, qty, unit_price")
          .in("return_id", returnRows.map((r: any) => r.id));
        const itemsByReturn: Record<string, any[]> = {};
        for (const ri of returnItemRows ?? []) {
          const rid = (ri as any).return_id;
          if (!itemsByReturn[rid]) itemsByReturn[rid] = [];
          itemsByReturn[rid].push(ri);
        }
        if (!active) return;
        setReturns(
          returnRows.map((r: any) => ({
            id: r.id,
            returnNumber: r.return_number,
            totalRefund: Number(r.total_refund),
            resolution: r.resolution,
            reason: r.reason,
            processedByName: r.processed_by_name ?? "—",
            createdAt: r.created_at,
            items: (itemsByReturn[r.id] ?? []).map((it: any) => ({
              productName: it.product_name,
              variantName: it.variant_name,
              qty: it.qty,
              unitPrice: Number(it.unit_price),
            })),
          }))
        );
      } catch {
        /* returns table absent on an older deployment: the sale still renders */
      }
    }
    fetchReturnHistory();
    return () => {
      active = false;
    };
  }, [saleId]);

  const returnedQtyMap: Record<string, number> = {};
  for (const ret of returns) {
    for (const ri of ret.items) {
      const key = `${ri.productName}-${ri.variantName}`;
      returnedQtyMap[key] = (returnedQtyMap[key] ?? 0) + ri.qty;
    }
  }
  const totalReturned = returns.reduce((sum, r) => sum + r.totalRefund, 0);
  const withinReturnWindow = sale
    ? Date.now() - new Date(sale.createdAt).getTime() <= 30 * 24 * 60 * 60 * 1000
    : false;
  // An employee may return what they sold; the shop's own sales are open to its owner.
  const canReturn = !!sale && (isManager || sale.employeeId === user?.id) && withinReturnWindow;

  // Cost is the snapshot taken when the sale was made, never today's price — editing a
  // product must not silently rewrite the profit of every sale already made. The live
  // variant cost is only a fallback for lines written before snapshots existed.
  const variantCost = new Map<string, number>();
  products.forEach((p) => p.variants.forEach((v) => variantCost.set(v.id, v.costPrice)));
  const cogsOf = (item: SaleLine) => item.cogsAmount ?? (variantCost.get(item.variantId) ?? 0) * item.qty;

  async function handleSaveNote() {
    if (!sale || note === (sale.note ?? "")) return;
    setSavingNote(true);
    try {
      await updateNote(sale.id, note);
      addToast(t("saleDetail.noteSaved"), "success");
    } catch {
      addToast(t("saleDetail.couldNotSaveNote"), "error");
    } finally {
      setSavingNote(false);
    }
  }

  async function handleShare() {
    if (!sale) return;
    const { renderReceiptBlob } = await import("@/lib/receiptRenderer");
    const blob = await renderReceiptBlob(
      {
        saleNumber: sale.saleNumber,
        customerName: sale.customerName,
        customerPhone: sale.customerPhone ?? "",
        employeeName: sale.employeeName,
        paymentMethod: sale.paymentMethod ?? "cash",
        paymentType: sale.paymentType ?? "full",
        createdAt: sale.createdAt,
        totalAmount: sale.totalAmount,
        amountPaid: sale.amountPaid,
        outstandingBalance: sale.outstandingBalance,
        subtotal: sale.subtotal,
        items: sale.items.map((it) => ({
          productName: it.productName,
          variantName: it.variantName,
          qty: it.qty,
          unitPrice: it.unitPrice,
        })),
      } as any,
      t
    );
    if (!blob) {
      addToast(t("saleDetail.failedReceipt"), "error");
      return;
    }
    const fileName = `receipt-${sale.saleNumber}.png`;
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const base64 = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onloadend = () => resolve((r.result as string).split(",")[1]);
        r.readAsDataURL(blob);
      });
      await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache, recursive: true });
      const fileUri = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
      const { Share } = await import("@capacitor/share");
      await Share.share({
        title: t("saleSuccess.saleReceipt"),
        dialogTitle: t("saleSuccess.shareReceipt"),
        url: fileUri.uri,
        files: [fileUri.uri],
      });
      return;
    } catch {
      /* not a native shell: fall through to the web share sheet */
    }
    const file = new File([blob], fileName, { type: "image/png" });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ title: t("saleSuccess.saleReceipt"), files: [file] });
        return;
      } catch {
        /* the person dismissed the share sheet */
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    addToast(t("saleDetail.receiptImageSaved"), "success");
  }

  async function handleVoid() {
    // A second tap lands before React re-renders, so `disabled` alone would let two void
    // calls out — and the second would answer "already voided" as an ERROR toast right after
    // the owner successfully voided the sale.
    if (voidingRef.current || !sale || !voidReason.trim()) return;
    voidingRef.current = true;
    setVoiding(true);
    try {
      const { rpcVoidSale } = await import("@/lib/db");
      await rpcVoidSale(sale.id, voidReason.trim());
      setShowVoidDialog(false);
      addToast(t("copy.saleCancelled"), "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : t("admin.voidSaleFailed"), "error");
    } finally {
      voidingRef.current = false;
      setVoiding(false);
    }
  }

  if (!sale) {
    if (!salesReady) {
      return (
        <div className="flex flex-col w-full min-h-full pt-4" style={{ background: "var(--background)" }}>
          <SkeletonList rows={4} />
        </div>
      );
    }
    return (
      <div
        className="flex flex-col w-full min-h-full items-center justify-center"
        style={{ background: "var(--background)" }}
      >
        <p style={{ color: "var(--text-secondary)" }}>{t("saleDetail.saleNotFound")}</p>
      </div>
    );
  }

  const baseCost = sale.items.reduce((sum, item) => sum + cogsOf(item), 0);
  // Profit is net of what came back: a sale with a return did not earn what it first did.
  const netProfit = sale.totalAmount - baseCost - totalReturned;
  const margin = sale.totalAmount > 0 ? Math.round((netProfit / sale.totalAmount) * 100) : 0;
  const owes = sale.outstandingBalance > 0;

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("sales.saleDetails")} />

      <div className="flex flex-col gap-3 p-4 pb-8">
        {/* 1. The state of the sale, when it is not simply completed. */}
        {sale.isVoided && (
          <div
            className="rounded-[var(--radius-tile)] p-3"
            style={{ background: "var(--error-bg)", border: "1px solid var(--error-border)" }}
            data-testid="sale-voided-banner"
          >
            <p className="text-13 font-bold" style={{ color: "var(--error)" }}>
              {t("admin.saleVoided")}
            </p>
            <p className="text-12 mt-0.5" style={{ color: "var(--error)" }}>
              {sale.voidReason ? `${t("admin.reason")}: ${sale.voidReason}` : ""}
              {sale.voidedAt ? `${sale.voidReason ? " · " : ""}${formatDateTime(sale.voidedAt)}` : ""}
            </p>
          </div>
        )}

        {/* 2. The receipt. */}
        <SaleReceipt
          facts={{
            saleNumber: sale.saleNumber,
            createdAt: sale.createdAt,
            customerName: sale.customerName,
            customerPhone: sale.customerPhone ?? undefined,
            soldBy: sale.employeeName === user?.name ? t("saleSuccess.you") : sale.employeeName,
            paymentMethod: sale.paymentMethod,
            itemCount: sale.items.length,
            totalAmount: sale.totalAmount,
            amountPaid: sale.amountPaid,
            outstandingBalance: sale.outstandingBalance,
            voided: sale.isVoided ? { reason: sale.voidReason } : null,
          }}
        />

        {/* 3. The customer — the next question is always what they still owe. */}
        {customer && (
          <ListCard>
            <ListRow
              onClick={() => navigate(`${base}/customers/${customer.id}`)}
              emphasis
              tile={
                customer.imageUrl ? (
                  <img src={customer.imageUrl} alt={customer.name} className="size-10 shrink-0 rounded-full object-cover" />
                ) : (
                  <div
                    className="size-10 shrink-0 rounded-full flex items-center justify-center text-13 font-bold"
                    style={{ background: "var(--brand)", color: "#0a0a0a" }}
                  >
                    {customer.name.charAt(0).toUpperCase()}
                  </div>
                )
              }
              title={customer.name}
              meta={`${customer.outstandingBalance > 0 ? t("sales.outstandingBalance") + " " + formatCurrency(customer.outstandingBalance) : t("saleDetail.settled")}`}
              trailing={<ChevronRight size={18} className="shrink-0" style={{ color: "var(--text-secondary)" }} />}
            />
          </ListCard>
        )}

        {/* 4. What was sold. */}
        <div>
          <p className="ds-section-label mb-2 px-1" style={{ color: "var(--text-secondary)" }}>
            {t("sales.itemsSold")}
          </p>
          <ListCard>
            {sale.items.map((item) => {
              const returned = returnedQtyMap[`${item.productName}-${item.variantName}`] ?? 0;
              const fullyReturned = returned >= item.qty;
              return (
                <ListRow
                  key={item.id}
                  trailing={
                    <p className="text-14 font-bold shrink-0 tabular-nums">{formatCurrency(item.lineTotal)}</p>
                  }
                >
                  <div className="min-w-0">
                    <p className="text-14 font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                      {item.productName} {item.variantName}
                    </p>
                    {/* The price this sale was made at — kept because the product's price
                        changes later, and this line has to stay true. */}
                    <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                      {formatCurrency(item.unitPrice)} × {item.qty}
                    </p>
                    {returned > 0 && (
                      <span
                        className="inline-block text-10 font-semibold px-2 py-0.5 rounded-full mt-1"
                        style={{
                          background: fullyReturned ? "var(--error-bg)" : "var(--warning-bg)",
                          color: fullyReturned ? "var(--error)" : "var(--warning)",
                        }}
                      >
                        {fullyReturned
                          ? t("saleDetail.returned")
                          : t("saleDetail.partialReturn", { count: String(returned), total: String(item.qty) })}
                      </span>
                    )}
                  </div>
                </ListRow>
              );
            })}
          </ListCard>
        </div>

        {/* 5. The shop's own numbers — never on the customer's copy. */}
        {isManager && (
          <div className="rounded-[var(--radius-card)] p-4 flex flex-col gap-2" style={{ background: "var(--tone-card)" }}>
            <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
              {t("saleDetail.margin")}
            </p>
            <div className="flex items-center justify-between">
              <span className="text-13" style={{ color: "var(--text-secondary)" }}>
                {t("admin.baseCost")}
              </span>
              <span className="text-13 font-semibold tabular-nums" style={{ color: "var(--text-secondary)" }}>
                {formatCurrency(Math.round(baseCost))}
              </span>
            </div>
            {totalReturned > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-13" style={{ color: "var(--text-secondary)" }}>
                  {t("saleDetail.returns")}
                </span>
                <span className="text-13 font-semibold tabular-nums" style={{ color: "var(--error)" }}>
                  -{formatCurrency(totalReturned)}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between pt-2 mt-1" style={{ borderTop: "1px solid var(--divider)" }}>
              <span className="text-13 font-bold">
                {totalReturned > 0 ? t("saleDetail.netProfit") : t("saleDetail.profit")}
              </span>
              <span className="text-17 font-bold tabular-nums" style={{ color: "var(--brand-dark)" }}>
                {formatCurrency(Math.round(netProfit))}
                <span className="text-12 font-medium ms-2" style={{ color: "var(--text-secondary)" }}>
                  {margin}%
                </span>
              </span>
            </div>
          </div>
        )}

        {/* 6. Returns. */}
        {returns.length > 0 && (
          <div>
            <p className="ds-section-label mb-2 px-1" style={{ color: "var(--text-secondary)" }}>
              {t("saleDetail.returnHistory")}
            </p>
            <ListCard>
              {returns.map((ret) => (
                <ListRow
                  key={ret.id}
                  title={ret.returnNumber}
                  meta={`${formatDateTime(ret.createdAt)} · ${t("saleDetail.processedBy")} ${ret.processedByName}`}
                  description={
                    [
                      ...ret.items.map(
                        (rit) =>
                          `${rit.productName} ${rit.variantName} × ${rit.qty} — ${formatCurrency(rit.unitPrice * rit.qty)}`
                      ),
                      ...(ret.reason ? [`${t("saleDetail.reason")} ${ret.reason}`] : []),
                    ].join(" · ")
                  }
                  value={ret.resolution === "refund_cash" ? t("saleDetail.cashRefund") : t("saleDetail.creditNote")}
                  trailing={
                    <span className="text-13 font-bold tabular-nums shrink-0" style={{ color: "var(--error)" }}>
                      -{formatCurrency(ret.totalRefund)}
                    </span>
                  }
                />
              ))}
            </ListCard>
          </div>
        )}

        {/* 7. The note, on its own. */}
        <div className="rounded-[var(--radius-card)] p-4" style={{ background: "var(--tone-card)" }}>
          <div className="flex items-center justify-between mb-2">
            <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
              {t("saleDetail.note")}
            </p>
            {note !== (sale.note ?? "") && (
              <button
                onClick={handleSaveNote}
                disabled={savingNote}
                className="text-12 font-bold px-3 py-1 rounded-full"
                style={{ background: "var(--brand)", color: "#0a0a0a" }}
              >
                {savingNote ? t("saleDetail.saving") : t("saleDetail.save")}
              </button>
            )}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("saleDetail.addNote")}
            rows={3}
            className="w-full rounded-[var(--radius-tile)] px-4 py-3 text-14 resize-none outline-none"
            style={{ background: "var(--surface)", border: "1px solid var(--border-control)", color: "var(--text-primary)" }}
          />
        </div>

        {/* Actions, in the order this record is actually used: take the money that is still
            owed, send the receipt, return something, or undo the sale. */}
        <div className="flex flex-col gap-2 pt-1">
          {owes && customer && (
            <Button fullWidth size="lg" onClick={() => navigate(`${base}/customers/${customer.id}/record-payment`)}>
              <span className="inline-flex items-center gap-2">
                <Wallet size={16} /> {t("saleDetail.recordPayment")}
              </span>
            </Button>
          )}
          {/* Full width each, rather than two half-widths: "Process Return" wraps to two
              lines in half the screen in either language, and a two-line label inside a pill
              is the one thing that makes a row of buttons look unfinished. */}
          <Button variant="outline" size="md" fullWidth onClick={handleShare}>
            <span className="inline-flex items-center gap-2">
              <Share2 size={15} /> {t("saleDetail.share")}
            </span>
          </Button>
          {canReturn && (
            <Button
              variant="outline"
              size="md"
              fullWidth
              onClick={() => navigate(`${base}/sales/${sale.id}/return`)}
            >
              <span className="inline-flex items-center gap-2">
                <RotateCcw size={15} /> {t("sales.return")}
              </span>
            </Button>
          )}
          {!withinReturnWindow && (
            <p className="text-11 text-center inline-flex items-center justify-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
              <Clock size={12} /> {t("saleDetail.returnWindowExpired")}
            </p>
          )}
          {canVoid && !sale.isVoided && (
            <button
              onClick={() => setShowVoidDialog(true)}
              className="flex items-center justify-center gap-2 w-full h-11 rounded-full text-14 font-semibold"
              style={{ color: "var(--error)" }}
            >
              <Trash2 size={15} /> {t("admin.voidSale")}
            </button>
          )}
        </div>
      </div>

      {/* Void: one reason, then it is done. */}
      <Sheet open={showVoidDialog} title={t("admin.voidSale")} onClose={() => setShowVoidDialog(false)}>
        <div className="px-5 pb-5 flex flex-col gap-4">
          <p className="text-14 text-center" style={{ color: "var(--text-secondary)" }}>
            {t("admin.voidConfirm", { number: sale.saleNumber })}
          </p>
          <input
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder={t("sale.voidReasonPlaceholder")}
            className="w-full h-11 rounded-full px-4 text-14 outline-none"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border-control)", color: "var(--text-primary)" }}
          />
          <div className="flex gap-3">
            <Button variant="outline" size="md" className="flex-1" onClick={() => setShowVoidDialog(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              size="md"
              className="flex-1"
              onClick={handleVoid}
              disabled={!voidReason.trim() || voiding}
            >
              {voiding ? t("admin.voiding") : t("admin.voidSale")}
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

interface ReturnRecord {
  id: string;
  returnNumber: string;
  totalRefund: number;
  resolution: string;
  reason: string | null;
  processedByName: string;
  createdAt: string;
  items: { productName: string; variantName: string; qty: number; unitPrice: number }[];
}
