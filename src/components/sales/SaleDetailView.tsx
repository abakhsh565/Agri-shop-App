import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import Button from "@/components/ui/Button";
import Sheet from "@/components/ui/Sheet";
import { SkeletonList } from "@/components/ui/Skeleton";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import {
  calculatePaymentStatus,
  getPaymentStatusColor,
  getPaymentStatusLabel,
} from "@/lib/reminderEngine";
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
import { summariseSale, refundedCogs, profitDisplay } from "@/lib/profit";
import { ChevronRight, Share2, Wallet, RotateCcw, Trash2, Clock } from "lucide-react";

/**
 * One sale, every fact it holds, in the order a person reads them.
 *
 * This is a **record**, not a receipt: the customer's copy is generated from the success
 * screen and the Share button, and printing a copy of it here said nothing the page did not
 * already have to say. What a sale record has to answer is a different set of questions —
 * which sale is this, who bought, who sold, what was on it, what was paid and what is still
 * owed against it, what the shop made, whether anything came back, and what can still be done.
 *
 * It is one screen for both shells because it was two that had drifted apart (one printed a
 * cost and profit line under every item, the other did not; neither showed the sale number,
 * and an already-voided sale still offered Return and Void because the void was local state).
 * The shop's own figures appear only for the shopkeeper; everything else is the same record.
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

  const isManager = user?.role === "admin";
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
  // variant cost is only a fallback for lines the snapshot could not price.
  const variantCost = new Map<string, number>();
  products.forEach((p) => p.variants.forEach((v) => variantCost.set(v.id, v.costPrice)));
  const liveCost = (id?: string | null) => (id ? variantCost.get(id) : undefined);

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

  // Every figure here comes from the one shared calculation (src/lib/profit.ts), so this
  // page cannot disagree with the list it was opened from.
  const summary = summariseSale(sale, liveCost);
  const baseCost = summary.cogs;
  // Profit is net of what came back: a sale with a return did not earn what it first did.
  // The refund is the customer's price; the goods themselves came back to the shelf, so
  // their cost is no longer consumed by this sale and must not be charged to it —
  // otherwise a return costs the profit twice.
  const netProfit = summary.profit - totalReturned + refundedCogs(sale, returnedQtyMap, liveCost);
  const margin = summary.revenue > 0 ? Math.round((netProfit / summary.revenue) * 100) : 0;
  const profit = profitDisplay(summary);
  const owes = sale.outstandingBalance > 0;
  // This customer today: the sale's own balance is already inside it, so the useful thing is
  // the standing it leaves them in — and whether they are past their limit because of it.
  // How this customer pays, in the app's one payment-status vocabulary rather than a second
  // opinion invented for this screen. "Very late" and "Over the limit" are different
  // questions — whether the money is overdue, and whether there is room for more — and a
  // customer can honestly be one of each at once, so both are shown rather than merged.
  const paymentStatus = customer ? calculatePaymentStatus(customer, new Date()) : null;
  const paymentStatusLabel = paymentStatus ? getPaymentStatusLabel(paymentStatus, t) : "";

  // The credit position: 100% of the limit and over is the ceiling reached, 80% is where the
  // app treats a customer as getting close (the threshold the customer page's limit bar turns
  // amber at), below that they are within it. A customer with no limit set has no credit
  // position to report, so they get no pill and no line rather than a misleading "within".
  const creditPct =
    customer && customer.creditLimit > 0
      ? Math.round((customer.outstandingBalance / customer.creditLimit) * 100)
      : 0;
  // The chips borrow the payment-status palette instead of inventing colours: the same green,
  // amber and red mean the same thing on both pills, in both themes.
  const creditState =
    !customer || customer.creditLimit <= 0
      ? null
      : creditPct >= 100
        ? { label: t("saleDetail.creditOver"), color: "var(--error)", chip: getPaymentStatusColor("high_risk") }
        : creditPct >= 80
          ? { label: t("saleDetail.creditNear"), color: "var(--warning)", chip: getPaymentStatusColor("delayed") }
          : { label: t("saleDetail.creditWithin"), color: "var(--brand-dark)", chip: getPaymentStatusColor("on_time") };
  const paymentStatusChip = paymentStatus ? getPaymentStatusColor(paymentStatus) : null;

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      {/* The state of the sale rides in the header, where the reference puts its step — and
          the sale's identity is the one line under the title, as a document's details are.
          Both used to be a card of their own that said three facts for 90px of height and
          pushed the two things this page is about (who bought, what was on it) below it. */}
      {/* No status chip up here: it said "credit · Rs. 4,050", which is exactly what the
          Outstanding Balance row now says in the group where it belongs. */}
      <NavHeader title={t("sales.saleDetails")} />

      <div className="flex flex-col gap-4 p-4 pb-8">
        <p
          className="text-12 text-center -mt-2"
          style={{ color: "var(--text-tertiary)" }}
          data-testid="sale-identity"
        >
          {sale.saleNumber} · {formatDateTime(sale.createdAt)}
        </p>
        {/* The state of the sale, when it is not simply completed. */}
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

        {/* 1. The customer, and what this sale leaves on his account. No heading — one row
            and one set of figures do not need announcing. The phone number is gone (a tap
            away, and already known) and so is the "customer since" line (it changed nothing
            about this sale). What no other screen at this moment shows is his credit
            position: the limit he is working against and how much of it this unpaid balance
            is using — so that leads, next to the name, and is quantified under the figures. */}
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
              trailing={<ChevronRight size={18} className="shrink-0" style={{ color: "var(--text-secondary)" }} />}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="ds-row-strong truncate">{customer.name}</span>
                {creditState && (
                  <span
                    className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-10 font-bold whitespace-nowrap"
                    style={{ background: creditState.chip.bg, color: creditState.chip.color }}
                  >
                    {creditState.label}
                  </span>
                )}
                {paymentStatusChip && (
                  <span
                    className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-10 font-bold whitespace-nowrap"
                    style={{ background: paymentStatusChip.bg, color: paymentStatusChip.color }}
                  >
                    {paymentStatusLabel}
                  </span>
                )}
              </div>
              {/* Where the phone number used to be: what this person still owes the shop
                  and how much of their credit that uses up. It is one sentence, and it is
                  the sentence that decides whether the next sale on credit happens, so it
                  sits under the name and the standing beside it rather than under the
                  figures — the account balance is the customer's, not this order's. */}
              {creditState && (
                <p className="ds-row-meta truncate" style={{ color: creditState.color }}>
                  {t("creditOverrides.limitUsed", {
                    outstanding: formatCurrency(customer.outstandingBalance),
                    pct: String(creditPct),
                  })}
                </p>
              )}
            </ListRow>

            <div className="px-4 py-4">
              {/* What this sale was worth and what he put down on it. His account balance
                  is stated once, on the line under his name, so it is not repeated here. */}
              <div className="flex items-stretch">
                {[
                  { label: t("saleDetail.thisSale"), value: formatCurrency(sale.totalAmount) },
                  { label: t("saleDetail.customerPaid"), value: formatCurrency(sale.amountPaid) },
                ].map((stat, index) => (
                  <div
                    key={stat.label}
                    className="flex-1 min-w-0 px-2 text-center"
                    style={index > 0 ? { borderInlineStart: "1px solid var(--divider)" } : undefined}
                  >
                    <p className="ds-stat-label">{stat.label}</p>
                    <p
                      className="text-13 font-bold tabular-nums mt-1 truncate"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {stat.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </ListCard>
        )}

        {/* 2. What was sold, and what it came to — one card, the way an order reads: the
            goods, then the money they add up to. The card's own hairline separates the two
            halves, so the grouping needs no second border around it. */}
        <div>
          <p className="ds-section-label mb-2 px-1" style={{ color: "var(--text-secondary)" }}>
            {t("saleDetail.orderSummary")}
          </p>
          <ListCard>
            {sale.items.map((item) => {
              const returned = returnedQtyMap[`${item.productName}-${item.variantName}`] ?? 0;
              const fullyReturned = returned >= item.qty;
              const product = products.find((p) => p.id === item.productId);
              return (
                <ListRow
                  key={item.id}
                  tile={<ProductThumb name={item.productName} imageUrl={product?.imageUrl} />}
                  title={`${item.productName} ${item.variantName}`}
                  meta={`${item.qty} × ${formatCurrency(item.unitPrice)}`}
                  description={
                    returned > 0
                      ? fullyReturned
                        ? t("saleDetail.returned")
                        : t("saleDetail.partialReturn", { count: String(returned), total: String(item.qty) })
                      : undefined
                  }
                  trailing={
                    <p className="text-14 font-bold shrink-0 tabular-nums">{formatCurrency(item.lineTotal)}</p>
                  }
                />
              );
            })}

            <div className="px-4 py-4">
              <p className="ds-section-label mb-3" style={{ color: "var(--text-secondary)" }}>
                {t("saleDetail.priceDetails")}
              </p>
              <div className="flex flex-col gap-2">
                {/* The order's own amount leads, then what is left on it and what has been
                    paid against it, and the total closes the group: read top to bottom it
                    is the ledger line a shopkeeper says out loud — "4,750 of goods, 4,050
                    still on him, he has given 700, 4,750 in all". */}
                <AmountRow label={t("sale.subtotal")} value={formatCurrency(sale.subtotal)} />
                {sale.taxAmount > 0 && (
                  <AmountRow label={t("saleDetail.tax")} value={formatCurrency(sale.taxAmount)} />
                )}
                {totalReturned > 0 && (
                  <AmountRow
                    label={t("saleDetail.returns")}
                    value={`-${formatCurrency(totalReturned)}`}
                    tone="var(--error)"
                  />
                )}
                {owes && (
                  <AmountRow
                    label={t("sales.outstandingBalance")}
                    value={formatCurrency(sale.outstandingBalance)}
                    tone="var(--warning)"
                    strong
                  />
                )}
                <AmountRow label={t("sales.amountPaid")} value={formatCurrency(sale.amountPaid)} />
                <div
                  className="flex items-baseline justify-between gap-3 pt-3 mt-1"
                  style={{ borderTop: "1px solid var(--divider)" }}
                >
                  <span className="text-14 font-bold" style={{ color: "var(--text-primary)" }}>
                    {t("saleSuccess.totalAmount")}
                  </span>
                  <span className="text-20 font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                    {formatCurrency(sale.totalAmount)}
                  </span>
                </div>
              </div>

              {/* Who sold it and how it was paid: part of this order's own record, so it
                  stays in this card — but a tone quieter, so it never reads as another
                  amount in the column above. */}
              <div className="mt-3 pt-3 flex flex-col gap-1.5" style={{ borderTop: "1px solid var(--divider)" }}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-12" style={{ color: "var(--text-tertiary)" }}>
                    {t("saleDetail.soldBy")}
                  </span>
                  <span className="text-12" style={{ color: "var(--text-secondary)" }}>
                    {sale.employeeName === user?.name ? t("saleSuccess.you") : sale.employeeName}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-12" style={{ color: "var(--text-tertiary)" }}>
                    {t("saleDetail.paidVia")}
                  </span>
                  <span className="text-12" style={{ color: "var(--text-secondary)" }}>
                    {sale.paymentMethod === "bank_transfer" ? t("sale.bankTransfer") : t("sale.cash")}
                  </span>
                </div>
              </div>
            </div>
          </ListCard>
        </div>

        {/* 3. The shop's own numbers — never on the customer's copy. */}
        {isManager && (
          <div className="ds-card">
            <p className="ds-section-label mb-3" style={{ color: "var(--text-secondary)" }}>
              {t("saleDetail.margin")}
            </p>
            <div className="flex flex-col gap-2">
              <div className="flex justify-between">
                <span className="text-13" style={{ color: "var(--text-secondary)" }}>
                  {t("admin.baseCost")}
                </span>
                {/* "Rs. 0" would be a claim that the goods were free. When the cost was
                    never recorded the row says so instead of asserting a number. */}
                <span className="text-13 font-semibold tabular-nums" style={{ color: "var(--text-secondary)" }}>
                  {summary.cogs === 0 && summary.unknownLines > 0
                    ? t("saleDetail.costNotRecorded")
                    : formatCurrency(Math.round(baseCost))}
                </span>
              </div>
              <div className="flex justify-between items-center pt-2" style={{ borderTop: "1px solid var(--divider)" }}>
                <span className="text-13 font-bold">
                  {totalReturned > 0 ? t("saleDetail.netProfit") : t("saleDetail.profit")}
                </span>
                <span className="text-17 font-bold tabular-nums" style={{ color: "var(--brand-dark)" }}>
                  {profit.kind === "unknown"
                    ? "—"
                    : `${profit.kind === "atLeast" ? t("saleDetail.atLeast") + " " : ""}${formatCurrency(Math.round(netProfit))}`}
                  {profit.kind !== "unknown" && (
                    <span className="text-12 font-medium ms-2" style={{ color: "var(--text-secondary)" }}>
                      {margin}%
                    </span>
                  )}
                </span>
              </div>
              {/* A profit worked out without a cost is not a profit. Say which it is rather
                  than letting the owner find out by distrusting the number. */}
              {profit.kind !== "exact" && (
                <p
                  className="text-11 mt-1"
                  style={{ color: "var(--warning)" }}
                  data-testid="sale-profit-cost-missing"
                >
                  {profit.kind === "unknown"
                    ? t("saleDetail.addCostToSeeProfit")
                    : t("saleDetail.costMissingOn", { count: String(profit.unknownLines) })}
                </p>
              )}
            </div>
          </div>
        )}

        {/* 4. Anything that came back. */}
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
                  description={[
                    ...ret.items.map(
                      (rit) =>
                        `${rit.productName} ${rit.variantName} × ${rit.qty} — ${formatCurrency(rit.unitPrice * rit.qty)}`
                    ),
                    ...(ret.reason ? [`${t("saleDetail.reason")} ${ret.reason}`] : []),
                  ].join(" · ")}
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

        {/* 5. The note on this sale. */}
        <div className="ds-card">
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

        {/* 6. What can still be done with it. Four equal stacked buttons is not a
            hierarchy, it is a list — so: ONE filled action for the thing this sale most
            likely needs next, the secondary actions side by side beneath it (the reference
            answers an order with a two-up action bar for the same reason), and the
            destructive one alone at the bottom under its own hairline, where a thumb
            cannot reach it on the way to anything else. */}
        <div className="flex flex-col gap-2 pt-1">
          {owes && customer && (
            <Button
              fullWidth
              size="lg"
              testId="sale-record-payment"
              onClick={() => navigate(`${base}/customers/${customer.id}/record-payment`)}
            >
              <span className="inline-flex items-center gap-2">
                <Wallet size={16} /> {t("saleDetail.recordPayment")}
              </span>
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="md" className="flex-1 px-3" testId="sale-share" onClick={handleShare}>
              <span className="inline-flex items-center gap-2">
                <Share2 size={15} /> {t("saleDetail.share")}
              </span>
            </Button>
            {canReturn && (
              <Button
                variant="outline"
                size="md"
                className="flex-1 px-3"
                testId="sale-return"
                onClick={() => navigate(`${base}/sales/${sale.id}/return`)}
              >
                <span className="inline-flex items-center gap-2">
                  <RotateCcw size={15} /> {t("sales.return")}
                </span>
              </Button>
            )}
          </div>
          {!withinReturnWindow && (
            <p
              className="text-11 text-center inline-flex items-center justify-center gap-1.5"
              style={{ color: "var(--text-secondary)" }}
            >
              <Clock size={12} /> {t("saleDetail.returnWindowExpired")}
            </p>
          )}
          {canVoid && !sale.isVoided && (
            <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--divider)" }}>
              <button
                onClick={() => setShowVoidDialog(true)}
                data-testid="sale-void"
                className="flex items-center justify-center gap-2 w-full h-11 rounded-full text-14 font-semibold"
                style={{ color: "var(--error)" }}
              >
                <Trash2 size={15} /> {t("admin.voidSale")}
              </button>
            </div>
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

/**
 * One money line in the order's price details: label on the leading edge, figure on the
 * trailing one, in tabular figures so a column of amounts lines up digit for digit.
 */
function AmountRow({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-13" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <span
        className={`tabular-nums ${strong ? "text-14 font-bold" : "text-13 font-semibold"}`}
        style={{ color: tone ?? "var(--text-primary)" }}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * A line's product image, or its initial when the shop never added one.
 *
 * The sale snapshots the product's *name*, not its picture, so this reads the live product
 * and simply falls back when it has been archived or deleted — a receipt of a sale is not
 * the place to fail because the catalogue moved on.
 */
function ProductThumb({ name, imageUrl }: { name: string; imageUrl?: string }) {
  if (imageUrl) {
    return (
      <img src={imageUrl} alt="" className="size-10 shrink-0 rounded-[10px] object-cover" />
    );
  }
  return (
    <div
      className="size-10 shrink-0 rounded-[10px] flex items-center justify-center text-13 font-bold"
      style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
    >
      {name.charAt(0).toUpperCase()}
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
