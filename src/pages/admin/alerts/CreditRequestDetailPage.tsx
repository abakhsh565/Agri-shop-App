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
  getCreditRequests,
  approveCreditRequest,
  rejectCreditRequest,
  type LocalCreditRequest,
} from "@/lib/localGroupRegistry";

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

  useEffect(() => {
    const requests = getCreditRequests();
    const found = requests.find((r) => r.id === requestId) || null;
    setRequest(found);
    setLoading(false);
  }, [requestId]);

  const customer = request ? customers.find((c) => c.id === request.customerId) : null;

  async function handleApprove() {
    if (!request || !user) return;
    setProcessing(true);
    try {
      await approveCreditRequest(request.id, user.name || user.id);
      setRequest({
        ...request,
        status: "approved",
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
        <NavHeader title={isUrdu ? "کریڈٹ درخواست" : "Credit Request"} />
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
        <NavHeader title={isUrdu ? "کریڈٹ درخواست" : "Credit Request"} />
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-[14px]" style={{ color: "var(--text-secondary)" }}>{isUrdu ? "درخواست نہیں ملی" : "Request not found"}</p>
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
        <p className="text-[16px] font-semibold flex-1" style={{ color: "var(--text-primary)" }}>
          {isUrdu ? "کریڈٹ حد کی درخواست" : "Credit Override"}
        </p>
      </div>

      <div className="flex flex-col gap-4 px-4 pb-8">
        {/* Warning banner — only for approved with high risk */}
        {isApproved && customer && customer.outstandingBalance > 0 && (
          <div className="rounded-[12px] px-4 py-3 flex items-center gap-2.5" style={{ background: "rgba(220, 38, 38, 0.06)", border: "1px solid rgba(220, 38, 38, 0.15)" }}>
            <AlertTriangle size={16} style={{ color: "#dc2626" }} />
            <p className="text-[13px] font-medium" style={{ color: "#991b1b" }}>
              {isUrdu ? "کریڈٹ منظور شدہ — گاہک سرخ فہرست میں ہے" : "Credit approved for a customer marked red"}
            </p>
          </div>
        )}

        {/* Customer profile — real data */}
        {customer && (
          <button
            onClick={() => navigate(`/admin/customers/${request.customerId}`)}
            className="rounded-[12px] p-4 flex items-center gap-3 text-start transition-opacity active:opacity-70"
            style={{ background: "var(--surface-2)" }}
          >
            <div className="w-11 h-11 rounded-full flex items-center justify-center text-[14px] font-bold shrink-0" style={{ background: customer.outstandingBalance > 0 ? "#fee2e2" : "#d9f99d", color: customer.outstandingBalance > 0 ? "#dc2626" : "#166534" }}>
              {customer.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>{customer.name}</p>
              <p className="text-[12px] mt-0.5" style={{ color: customer.outstandingBalance > 0 ? "#dc2626" : "var(--text-secondary)" }}>
                {formatCurrency(customer.outstandingBalance)} {isUrdu ? "واجب الادا" : "outstanding"}
              </p>
            </div>
            <ChevronRight size={16} style={{ color: "var(--text-secondary)", transform: isUrdu ? "rotate(180deg)" : "none" }} />
          </button>
        )}

        {/* Request details — key-value card */}
        <div className="rounded-[12px] overflow-hidden" style={{ background: "var(--surface-2)" }}>
          {/* Approved by */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--divider)" }}>
            <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{isUrdu ? "منظور شدہ" : "Approved by"}</span>
            <span className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>{request.reviewedBy || "—"}</span>
          </div>
          {/* Customer */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--divider)" }}>
            <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{isUrdu ? "گاہک" : "Customer"}</span>
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>{request.customerName}</span>
              {customer && customer.outstandingBalance > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#fee2e2", color: "#dc2626" }}>Red</span>
              )}
            </div>
          </div>
          {/* Amount */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--divider)" }}>
            <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{isUrdu ? "رقم" : "Amount"}</span>
            <span className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>{formatCurrency(request.requestedLimit)}</span>
          </div>
          {/* When */}
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{isUrdu ? "وقت" : "When"}</span>
            <span className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>
              {new Date(request.createdAt).toLocaleDateString()}{" "}
              {new Date(request.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        </div>

        {/* Why flagged — real business context */}
        {request.reason && (
          <div className="rounded-[12px] p-4" style={{ background: "var(--surface-2)" }}>
            <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-secondary)" }}>
              {isUrdu ? "وجہ" : "WHY FLAGGED"}
            </p>
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-primary)" }}>{request.reason}</p>
          </div>
        )}

        {/* Status for processed requests */}
        {!isPending && request.reviewedAt && (
          <div className="rounded-[12px] px-4 py-3 flex items-center gap-2" style={{ background: isApproved ? "rgba(22, 163, 74, 0.06)" : "rgba(220, 38, 38, 0.06)" }}>
            {isApproved ? <CheckCircle2 size={16} style={{ color: "#16a34a" }} /> : <XCircle size={16} style={{ color: "#dc2626" }} />}
            <p className="text-[13px] font-medium" style={{ color: isApproved ? "#166534" : "#991b1b" }}>
              {isApproved ? (isUrdu ? `منظور شدہ — ${request.reviewedBy}` : `Approved by ${request.reviewedBy}`) : (isUrdu ? `مسترد شدہ — ${request.reviewedBy}` : `Rejected by ${request.reviewedBy}`)}
            </p>
          </div>
        )}

        {/* Action buttons — approve/reject on right */}
        {isPending && (
          <div className="flex gap-3 justify-end">
            <button
              onClick={handleReject}
              disabled={processing}
              className="h-11 px-5 rounded-full text-[13px] font-bold flex items-center justify-center gap-2 transition-transform active:scale-[0.97]"
              style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--divider)", opacity: processing ? 0.6 : 1 }}
            >
              <XCircle size={16} /> {isUrdu ? "رد" : "Reject"}
            </button>
            <button
              onClick={handleApprove}
              disabled={processing}
              className="h-11 px-5 rounded-full text-[13px] font-bold flex items-center justify-center gap-2 transition-transform active:scale-[0.97]"
              style={{ background: "var(--brand)", color: "#0a0a0a", opacity: processing ? 0.6 : 1 }}
            >
              <CheckCircle2 size={16} /> {isUrdu ? "منظور" : "Approve"}
            </button>
          </div>
        )}

        {/* Mark as reviewed */}
        {!isPending && (
          <button
            onClick={() => navigate(-1)}
            className="w-full h-11 rounded-full text-[13px] font-semibold flex items-center justify-center"
            style={{ color: "var(--brand-dark, #65a30d)" }}
          >
            {isUrdu ? "واپس جائیں" : "Mark as reviewed"}
          </button>
        )}
      </div>
    </div>
  );
}
