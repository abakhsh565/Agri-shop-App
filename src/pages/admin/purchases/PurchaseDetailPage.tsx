import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useThemeStore } from "@/stores/themeStore";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import SectionActionsSheet, { SectionActionsButton } from "@/components/ui/SectionActionsSheet";
import { Building2, HandCoins, Printer, Share2 } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { exportText } from "@/lib/exportData";
import { supabase } from "@/lib/supabase";

import type { Purchase } from "@/types";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { hasPermission } from "@/lib/tenantContext";

/** Text for the print window: a supplier name with a quote in it must not end the markup. */
function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export default function PurchaseDetailPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const { purchaseId } = useParams();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const { addToast } = useUIStore();
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionsOpen, setActionsOpen] = useState(false);

  useEffect(() => {
    if (!purchaseId) return;
    setLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase
          .from("purchases")
          .select("*, purchase_items(*)")
          .eq("id", purchaseId)
          .single();
        if (!error && data) {
          setPurchase({
            id: data.id,
            purchaseNumber: data.purchase_number,
            companyId: data.company_id,
            companyName: data.company_name ?? "",
            items: (data.purchase_items ?? []).map((it: any) => ({
              id: it.id,
              purchaseId: it.purchase_id,
              productId: it.product_id,
              productName: it.product_name,
              variantId: it.variant_id,
              variantName: it.variant_name,
              qty: it.qty,
              costPrice: it.unit_price,
              lineTotal: it.line_total,
            })),
            totalAmount: data.total_amount,
            amountPaid: data.amount_paid,
            outstandingPayable: data.amount_due,
            // `payment_method` arrives with 0258; a bill booked before it really was cash-only
            // as far as the record knows, so that is the honest default rather than blank.
            paymentMethod: data.payment_method ?? "cash",
            // The bill's columns are `notes` and `recorded_by`; reading `note`/`created_by`
            // (names that exist on other tables) is why both always came back empty here.
            note: data.notes ?? undefined,
            createdAt: data.created_at,
            createdBy: data.recorded_by ?? "",
          });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [purchaseId]);

  if (loading) {
    return (
      <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("purchases.detailTitle")} historyBack />
        <div className="flex-1 pt-4">
          <SkeletonList rows={3} tile={false} />
        </div>
      </div>
    );
  }

  if (!purchase) {
    return (
      <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("purchases.detailTitle")} historyBack />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("purchase.notFound")}</p>
        </div>
      </div>
    );
  }

  /**
   * The bill's actions, in the app's one menu: pay it, print it, send it, or open who it is with.
   * Printing draws the same rows the screen shows — no second query, so paper cannot disagree
   * with the page.
   */
  function printBill() {
    if (!purchase) return;
    setActionsOpen(false);
    const win = window.open("", "_blank");
    if (!win) {
      addToast(t("purchase.printBlocked"), "error");
      return;
    }
    const rows = purchase.items
      .map(
        (item) =>
          `<tr><td>${esc(item.productName)}${item.variantName ? ` · ${esc(item.variantName)}` : ""}</td>` +
          `<td>${item.qty}</td><td>${esc(formatCurrency(item.costPrice))}</td>` +
          `<td>${esc(formatCurrency(item.lineTotal))}</td></tr>`,
      )
      .join("");
    win.document.write(`<!doctype html>
<html dir="${isUrdu ? "rtl" : "ltr"}"><head><meta charset="utf-8">
<title>${esc(purchase.purchaseNumber)}</title>
<style>
  body { font-family: Inter, system-ui, -apple-system, sans-serif; padding: 32px; color: #111; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { margin: 0 0 2px; color: #555; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 16px; }
  td { padding: 6px 0; border-bottom: 1px solid #ddd; }
  td + td { text-align: end; }
  tfoot td { border-bottom: 0; font-weight: 600; padding-top: 12px; }
</style></head>
<body>
  <h1>${esc(purchase.purchaseNumber)}</h1>
  <p>${esc(purchase.companyName)} · ${esc(formatDateTime(purchase.createdAt))}</p>
  <p>${esc(t("saleReview.totalAmount"))}: ${esc(formatCurrency(purchase.totalAmount))} · ${esc(t("common.paid"))}: ${esc(formatCurrency(purchase.amountPaid))}</p>
  <table>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="3">${esc(t("purchase.outstandingPayable"))}</td><td>${esc(formatCurrency(purchase.outstandingPayable))}</td></tr></tfoot>
  </table>
</body></html>`);
    win.document.close();
    win.focus();
    win.setTimeout(() => win.print(), 250);
  }

  async function shareBill() {
    if (!purchase) return;
    setActionsOpen(false);
    const text = [
      purchase.purchaseNumber,
      `${t("common.supplier")}: ${purchase.companyName}`,
      ...purchase.items.map((item) => `${item.productName} × ${item.qty} — ${formatCurrency(item.lineTotal)}`),
      `${t("saleReview.totalAmount")}: ${formatCurrency(purchase.totalAmount)}`,
      `${t("common.paid")}: ${formatCurrency(purchase.amountPaid)}`,
      `${t("purchase.outstandingPayable")}: ${formatCurrency(purchase.outstandingPayable)}`,
    ].join("\n");
    try {
      const outcome = await exportText(text, purchase.purchaseNumber);
      addToast(outcome === "shared" ? t("purchase.shared") : t("purchase.copied"), "success");
    } catch {
      addToast(t("purchase.shareFailed"), "error");
    }
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader
        title={t("purchases.detailTitle")}
        historyBack
        right={
          <SectionActionsButton
            onClick={() => setActionsOpen(true)}
            label={t("purchase.menu")}
            testId="purchase-actions"
          />
        }
      />

      <SectionActionsSheet
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        title={t("purchase.menu")}
        actions={[
          ...(base === "/admin" && purchase.outstandingPayable > 0 && hasPermission("payments.view")
            ? [
                {
                  id: "pay" as const,
                  icon: HandCoins,
                  title: t("supplierPayments.record"),
                  description: t("purchase.payHint"),
                  onClick: () => {
                    setActionsOpen(false);
                    navigate(`${base}/payments/supplier/${purchase.companyId}`, {
                      state: { from: `${base}/purchases/${purchase.id}` },
                    });
                  },
                },
              ]
            : []),
          { id: "print", icon: Printer, title: t("purchase.print"), description: t("purchase.printHint"), onClick: printBill },
          { id: "share", icon: Share2, title: t("purchase.share"), description: t("purchase.shareHint"), onClick: () => { void shareBill(); } },
          {
            id: "supplier" as const,
            icon: Building2,
            title: t("purchase.viewSupplier"),
            description: t("purchase.viewSupplierHint"),
            onClick: () => {
              setActionsOpen(false);
              navigate(`${base}/companies/${purchase.companyId}`);
            },
          },
        ]}
      />

      <div className="flex flex-col gap-4 p-4">
        {/* Header card */}
        <div className="ds-card">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{purchase.purchaseNumber}</p>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{formatDateTime(purchase.createdAt)}</p>
          </div>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("common.supplier")}: <span className="font-medium" style={{ color: "var(--text-primary)" }}>{purchase.companyName}</span></p>
          {purchase.note && <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{t("admin.note")}: {purchase.note}</p>}
        </div>

        {/* Items */}
        <div>
          <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>{t("purchase.itemsPurchased")}</p>
          <ListCard>
            {purchase.items.map((item) => (
              <ListRow
                key={item.id}
                title={item.productName}
                meta={`${item.variantName} × ${item.qty}`}
                trailing={
                  <div className="text-end shrink-0 ms-3">
                    <p className="ds-row-strong">{formatCurrency(item.lineTotal)}</p>
                    <p className="text-10" style={{ color: "var(--text-secondary)" }}>{formatCurrency(item.costPrice)}/unit</p>
                  </div>
                }
              />
            ))}
          </ListCard>
        </div>

        {/* Payment summary */}
        <div className="ds-card">
          <p className="ds-section-label mb-3" style={{ color: "var(--text-secondary)" }}>{t("purchase.paymentSummary")}</p>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("saleReview.totalAmount")}</span>
              <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{formatCurrency(purchase.totalAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("common.paid")}</span>
              <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{formatCurrency(purchase.amountPaid)}</span>
            </div>
            {purchase.outstandingPayable > 0 && (
              <div className="flex justify-between">
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("purchase.outstandingPayable")}</span>
                <span className="text-sm font-bold" style={{ color: "var(--error)" }}>{formatCurrency(purchase.outstandingPayable)}</span>
              </div>
            )}
            <div className="border-t my-1" style={{ borderColor: "var(--divider)" }} />
            <div className="flex justify-between">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("sale.paymentMethod")}</span>
              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{purchase.paymentMethod === "cash" ? t("sale.cash") : t("sale.bankTransfer")}</span>
            </div>
          </div>
        </div>

        {/* The bill is the record of buying from this supplier; paying it is the one action its
            reader needs next. It opens the supplier's payment form on the balance the RPC uses. */}
        {base === "/admin" && purchase.outstandingPayable > 0 && hasPermission("payments.view") && (
          <button
            type="button"
            onClick={() =>
              navigate(`${base}/payments/supplier/${purchase.companyId}`, {
                state: { from: `${base}/purchases/${purchase.id}` },
              })
            }
            data-testid="purchase-record-payment"
            className="w-full h-12 rounded-full font-bold text-sm active:scale-[0.98] transition-transform"
            style={{ background: "#2c2c2a", color: "var(--brand)" }}
          >
            {t("supplierPayments.record")}
          </button>
        )}
      </div>
    </div>
  );
}
