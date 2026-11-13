import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Share2 } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useUIStore } from "@/stores/uiStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useT } from "@/lib/i18n";
import { fetchSupplierPayment, type SupplierPaymentEntry } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import { exportText } from "@/lib/exportData";

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-start justify-between gap-4 py-2.5 border-b last:border-b-0"
      style={{ borderColor: "var(--hairline)" }}
    >
      <span className="text-12 shrink-0" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <span className="text-13 font-semibold text-end break-words">{value}</span>
    </div>
  );
}

export default function SupplierPaymentDetailPage() {
  const t = useT();
  const { paymentId } = useParams<{ paymentId: string }>();
  const { addToast } = useUIStore();
  const companies = useCompaniesStore((s) => s.companies);
  const companiesReady = useCompaniesStore((s) => s.ready);
  const loadCompanies = useCompaniesStore((s) => s.load);

  const [payment, setPayment] = useState<SupplierPaymentEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!companiesReady) void loadCompanies();
  }, [companiesReady, loadCompanies]);

  useEffect(() => {
    if (!paymentId) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    fetchSupplierPayment(paymentId)
      .then((row) => {
        if (alive) setPayment(row);
      })
      .catch(() => {
        if (alive) setPayment(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [paymentId]);

  const supplierName =
    companies.find((company) => company.id === payment?.companyId)?.name ??
    (companiesReady ? t("moves.unknownItem") : "—");
  const methodLabel =
    payment?.method === "cash" ? t("sale.cash") : t("sale.bankTransfer");

  async function handleShare() {
    if (!payment) return;
    const lines = [
      t("supplierPayments.detailTitle"),
      `${t("common.supplier")}: ${supplierName}`,
      `${t("supplierPayments.amount")}: ${formatCurrency(payment.amount)}`,
      `${t("supplierPayments.paymentDate")}: ${formatDateTime(payment.createdAt)}`,
      `${t("sale.paymentMethod")}: ${methodLabel}`,
    ];
    if (payment.recordedByName) {
      lines.push(`${t("supplierPayments.recordedBy")}: ${payment.recordedByName}`);
    }
    if (payment.notes) lines.push(`${t("admin.note")}: ${payment.notes}`);
    if (payment.purchaseId) lines.push(t("supplierPayments.advance"));
    const text = lines.join("\n");

    setSharing(true);
    // The app's one share path: the native sheet on Android (Capacitor's Share), the browser's
    // own sheet on a phone, and the clipboard on a desktop. This form used to spell all three
    // out itself, which is how the same button behaved differently on different screens.
    try {
      const outcome = await exportText(text, t("supplierPayments.shareTitle"));
      addToast(
        outcome === "shared" ? t("supplierPayments.detailsShared") : t("supplierPayments.detailsCopied"),
        "success",
      );
    } catch {
      addToast(t("supplierPayments.shareFailed"), "error");
    } finally {
      setSharing(false);
    }
  }

  if (loading) {
    return (
      <div
        className="flex flex-col w-full min-h-full"
        style={{ background: "var(--background)", color: "var(--text-primary)" }}
      >
        <StatusBar />
        <NavHeader title={t("supplierPayments.detailTitle")} historyBack />
        <div className="pt-4">
          <SkeletonList rows={3} tile={false} />
        </div>
      </div>
    );
  }

  if (!payment) {
    return (
      <div
        className="flex flex-col w-full min-h-full"
        style={{ background: "var(--background)", color: "var(--text-primary)" }}
        data-testid="supplier-payment-detail-not-found"
      >
        <StatusBar />
        <NavHeader title={t("supplierPayments.detailTitle")} historyBack />
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-13 text-center" style={{ color: "var(--text-secondary)" }}>
            {t("supplierPayments.notFound")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="supplier-payment-detail"
    >
      <StatusBar />
      <NavHeader title={t("supplierPayments.detailTitle")} historyBack />

      <div className="flex flex-col gap-4 p-4">
        <div className="ds-card" data-testid="supplier-payment-detail-summary">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                {t("supplierPayments.paidTo")}
              </p>
              <p className="text-18 font-bold mt-1" data-testid="supplier-payment-detail-supplier">
                {supplierName}
              </p>
            </div>
            {payment.purchaseId && (
              <span
                className="shrink-0 text-10 font-semibold px-2 py-1 rounded-full"
                style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
              >
                {t("supplierPayments.advance")}
              </span>
            )}
          </div>
          <p
            className="text-32 font-bold mt-4 tabular-nums break-words"
            data-testid="supplier-payment-detail-amount"
          >
            {formatCurrency(payment.amount)}
          </p>
          <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>
            {formatDateTime(payment.createdAt)}
          </p>
        </div>

        <div className="ds-card">
          <DetailRow label={t("common.supplier")} value={supplierName} />
          <DetailRow label={t("supplierPayments.paymentDate")} value={formatDateTime(payment.createdAt)} />
          <DetailRow label={t("sale.paymentMethod")} value={methodLabel} />
          {payment.recordedByName && (
            <DetailRow label={t("supplierPayments.recordedBy")} value={payment.recordedByName} />
          )}
        </div>

        {payment.notes && (
          <div className="ds-card">
            <p className="text-11" style={{ color: "var(--text-secondary)" }}>
              {t("admin.note")}
            </p>
            <p className="text-13 mt-1 break-words">{payment.notes}</p>
          </div>
        )}

        <Button
          variant="cta"
          size="md"
          fullWidth
          loading={sharing}
          onClick={() => { void handleShare(); }}
          testId="supplier-payment-share"
        >
          <Share2 size={15} strokeWidth={2.5} className="me-2" />
          {t("supplierPayments.shareDetails")}
        </Button>
      </div>
    </div>
  );
}
