import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useCustomersStore } from "@/stores/customersStore";
import { useAuthStore } from "@/stores/authStore";
import { useThemeStore } from "@/stores/themeStore";
import { formatCurrency } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { ArrowLeft, AlertTriangle, ChevronRight, CheckCircle2, XCircle } from "lucide-react";
import {
  getCreditRequestsDB,
  approveCreditRequest,
  rejectCreditRequest,
  type LocalCreditRequest,
} from "@/lib/localGroupRegistry";
import { calculatePaymentStatus, getPaymentStatusLabel, getPaymentStatusColor } from "@/lib/reminderEngine";

export default function CreditRequestDetailPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const navigate = useNavigate();
  const t = useT();
  const { user } = useAuthStore();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";

  const customers = useCustomersStore((s) => s.customers);
  const [request, setRequest] = useState<LocalCreditRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  // What the owner is approving — starts at the requested amount and may be any figure at all
  // (0251): asked 100,000 and granting 50,000 is a decision, not an error.
  const [approvedAmount, setApprovedAmount] = useState("");

  useEffect(() => {
    (async () => {
      const requests = await getCreditRequestsDB();
    const found = requests.find((r) => r.id === requestId) || null;
    setRequest(found);
    if (found) setApprovedAmount(String(found.requestedLimit));
    setLoading(false);
    })();
  }, [requestId]);

  const customer = request ? customers.find((c) => c.id === request.customerId) : null;

  async function handleApprove() {
    if (!request || !user) return;
    const parsed = Number(approvedAmount.replace(/[^\d.]/g, ""));
    const amount = Number.isFinite(parsed) && approvedAmount.trim() !== "" ? parsed : request.requestedLimit;
    setProcessing(true);
    try {
      await approveCreditRequest(request.id, user.name || user.id, amount);
      setRequest({
        ...request,
        status: "approved",
        approvedLimit: amount,
        reviewedBy: user.name || null,
        reviewedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error(err);
    } finally {
      setProcessing(false);
    }
  }

  async function handleReject() {
    if (!request || !user) return;
    setProcessing(true);
    try {
      await rejectCreditRequest(request.id, user.name || user.id, "Rejected by admin");
      setRequest({
        ...request,
        status: "rejected",
        reviewedBy: user.name || null,
        reviewedAt: new Date().toISOString(),
        rejectionReason: "Rejected by admin",
      });
    } catch (err) {
      console.error(err);
    } finally {
      setProcessing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("inline.credit_request")} />
        <div className="flex-1 flex items-center justify-center">
          <div className="size-8 border-2 rounded-full animate-spin" style={{ borderColor: "var(--divider)", borderTopColor: "var(--brand)" }} />
        </div>
      </div>
    );
  }

  if (!request) {
    return (
      <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("inline.credit_request_x")} />
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-14" style={{ color: "var(--text-secondary)" }}>{t("inline.request_not_found")}</p>
        </div>
      </div>
    );
  }

  const isPending = request.status === "pending";
  const isApproved = request.status === "approved";

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}>
      <StatusBar />

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} className="size-9 rounded-full flex items-center justify-center" style={{ background: "var(--surface-2)" }}>
          <ArrowLeft size={18} style={{ color: "var(--text-primary)", transform: isUrdu ? "rotate(180deg)" : "none" }} />
        </button>
        <p className="text-16 font-semibold flex-1" style={{ color: "var(--text-primary)" }}>
          {t("inline.credit_override")}
        </p>
      </div>

      <div className="flex flex-col gap-4 px-4 pb-8">
        {/* Warning banner — only for approved with high risk */}
        {isApproved && customer && customer.outstandingBalance > 0 && (
          <div className="rounded-[var(--radius-tile)] px-4 py-3 flex items-center gap-2.5" style={{ background: "rgba(220, 38, 38, 0.06)", border: "1px solid rgba(220, 38, 38, 0.15)" }}>
            <AlertTriangle size={16} style={{ color: "#dc2626" }} />
            <p className="text-13 font-medium" style={{ color: "#991b1b" }}>
              {t("inline.credit_approved_customer_flagged_for_attenti")}
            </p>
          </div>
        )}

        {/* Customer profile — real data */}
        {customer && (
          <button
            onClick={() => navigate(`/admin/customers/${request.customerId}`)}
            className="rounded-[var(--radius-tile)] p-4 flex items-center gap-3 text-start transition-opacity active:opacity-70"
            style={{ background: "var(--surface-2)" }}
          >
            {customer.imageUrl ? (<img src={customer.imageUrl} alt="" className="w-11 h-11 rounded-full object-cover shrink-0" />) : (<div className="w-11 h-11 rounded-full flex items-center justify-center text-14 font-bold shrink-0" style={{ background: customer.outstandingBalance > 0 ? "#fee2e2" : "#d9f99d", color: customer.outstandingBalance > 0 ? "#dc2626" : "#166534" }}>{customer.name ? customer.name.charAt(0) : "?".toUpperCase()}</div>)}
            <div className="flex-1 min-w-0">
              <p className="text-15 font-semibold" style={{ color: "var(--text-primary)" }}>{customer.name}</p>
              <p className="text-12 mt-0.5" style={{ color: customer.outstandingBalance > 0 ? "#dc2626" : "var(--text-secondary)" }}>
                {formatCurrency(customer.outstandingBalance)} {t("customers.outstanding")}
              </p>
            </div>
            <ChevronRight size={16} style={{ color: "var(--text-secondary)", transform: isUrdu ? "rotate(180deg)" : "none" }} />
          </button>
        )}

        {/* Request details — key-value card */}
        <div className="rounded-[var(--radius-tile)] overflow-hidden" style={{ background: "var(--surface-2)" }}>
          {/* Who decided it. A rejected request says "Rejected by": the row carried the
              approval label whatever had happened, which read as a decision nobody made. */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--divider)" }}>
            <span className="text-12" style={{ color: "var(--text-secondary)" }}>
              {request.status === "rejected" ? t("inline.rejected_by") : t("inline.approved_by")}
            </span>
            <span className="text-14 font-semibold" style={{ color: "var(--text-primary)" }}>{request.reviewedBy || "—"}</span>
          </div>
          {/* Customer */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--divider)" }}>
            <span className="text-12" style={{ color: "var(--text-secondary)" }}>{t("receipt.customer")}</span>
            <div className="flex items-center gap-2">
              <span className="text-14 font-semibold" style={{ color: "var(--text-primary)" }}>{request.customerName}</span>
              {customer && (() => {
                const status = calculatePaymentStatus(customer, new Date());
                if (status === "paid") return null;
                const sc = getPaymentStatusColor(status);
                return (
                  <span className="text-10 font-bold px-2 py-0.5 rounded-full" style={{ background: sc.bg, color: sc.color }}>
                    {getPaymentStatusLabel(status, t)}
                  </span>
                );
              })()}
            </div>
          </div>
          {/* Requested amount */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--divider)" }}>
            <span className="text-12" style={{ color: "var(--text-secondary)" }}>{t("creditRequest.requestedAmount")}</span>
            <span className="text-14 font-semibold" style={{ color: "var(--text-primary)" }}>{formatCurrency(request.requestedLimit)}</span>
          </div>
          {/* Granted amount — what the owner actually approved, which may differ. */}
          {isApproved && request.approvedLimit != null && (
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--divider)" }}>
              <span className="text-12" style={{ color: "var(--text-secondary)" }}>{t("creditRequest.approvedAs")}</span>
              <span className="text-14 font-semibold" style={{ color: "var(--text-primary)" }}>{formatCurrency(request.approvedLimit)}</span>
            </div>
          )}
          {/* When */}
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-12" style={{ color: "var(--text-secondary)" }}>{t("common.when")}</span>
            <span className="text-14 font-semibold" style={{ color: "var(--text-primary)" }}>
              {new Date(request.createdAt).toLocaleDateString()}{" "}
              {new Date(request.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        </div>

        {/* Why flagged — real business context */}
        {request.reason && (
          <div className="rounded-[var(--radius-tile)] p-4" style={{ background: "var(--surface-2)" }}>
            <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
              {t("inline.why_flagged")}
            </p>
            <p className="text-13 leading-relaxed" style={{ color: "var(--text-primary)" }}>{request.reason}</p>
          </div>
        )}

        {/* Status for processed requests */}
        {!isPending && request.reviewedAt && (
          <div className="rounded-[var(--radius-tile)] px-4 py-3 flex items-center gap-2" style={{ background: isApproved ? "rgba(22, 163, 74, 0.06)" : "rgba(220, 38, 38, 0.06)" }}>
            {isApproved ? <CheckCircle2 size={16} style={{ color: "#16a34a" }} /> : <XCircle size={16} style={{ color: "#dc2626" }} />}
            <p className="text-13 font-medium" style={{ color: isApproved ? "#166534" : "#991b1b" }}>
              {isApproved
                ? t("common.approvedBy", { name: request.reviewedBy ?? "" })
                : t("common.rejectedBy", { name: request.reviewedBy ?? "" })}
            </p>
          </div>
        )}

        {/* The owner's own figure — the request says what was asked for, this says what is
            granted. Approving the requested number is the default and needs no action. */}
        {isPending && (
          <div className="rounded-[var(--radius-tile)] p-4 flex flex-col gap-2" style={{ background: "var(--surface-2)" }}>
            <label className="ds-section-label" htmlFor="credit-request-approved-amount" style={{ color: "var(--text-secondary)" }}>
              {t("creditRequest.approvedAmount")}
            </label>
            <input
              id="credit-request-approved-amount"
              type="number"
              inputMode="decimal"
              min="0"
              value={approvedAmount}
              onChange={(e) => setApprovedAmount(e.target.value)}
              data-testid="credit-request-approved-amount"
              className="w-full h-12 rounded-[var(--radius-input)] border border-border px-4 text-sm text-foreground placeholder:text-caption outline-none"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("creditRequest.amountHint")}</p>
              {approvedAmount !== String(request.requestedLimit) && (
                <button
                  onClick={() => setApprovedAmount(String(request.requestedLimit))}
                  className="text-11 font-semibold shrink-0"
                  style={{ color: "var(--brand-dark)" }}
                >
                  {t("creditRequest.useRequested")}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Action buttons — approve/reject on right */}
        {isPending && (
          <div className="flex gap-3 justify-end">
            <button
              onClick={handleReject}
              disabled={processing}
              className="h-11 px-5 rounded-full text-13 font-bold flex items-center justify-center gap-2 transition-transform active:scale-[0.97]"
              style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--divider)", opacity: processing ? 0.6 : 1 }}
            >
              <XCircle size={16} /> {t("superAdmin.reject")}
            </button>
            <button
              onClick={handleApprove}
              disabled={processing}
              className="h-11 px-5 rounded-full text-13 font-bold flex items-center justify-center gap-2 transition-transform active:scale-[0.97]"
              style={{ background: "var(--brand)", color: "#0a0a0a", opacity: processing ? 0.6 : 1 }}
            >
              <CheckCircle2 size={16} /> {t("superAdmin.approve")}
            </button>
          </div>
        )}

        {/* Mark as reviewed */}
        {!isPending && (
          <button
            onClick={() => navigate(-1)}
            className="w-full h-11 rounded-full text-13 font-semibold flex items-center justify-center"
            style={{ color: "var(--brand-dark, #65a30d)" }}
          >
            {t("inline.mark_as_reviewed")}
          </button>
        )}
      </div>
    </div>
  );
}
