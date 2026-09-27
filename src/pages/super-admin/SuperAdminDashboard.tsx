import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import { useShopRequestsStore, type ShopRequest, type ShopRequestStatus } from "@/stores/shopRequestsStore";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { formatCurrency } from "@/lib/formatters";
import {
  Clock, CheckCircle, XCircle, Eye, ChevronRight,
  Store, User, MapPin, Calendar, Filter
} from "lucide-react";
import { useT } from "@/lib/i18n";

const STATUS_TABS: { key: ShopRequestStatus | "all"; labelKey: string; color: string }[] = [
  { key: "all", labelKey: "superAdmin.tab.all", color: "var(--text-primary)" },
  { key: "pending", labelKey: "superAdmin.status.pending", color: "#f59e0b" },
  { key: "hold", labelKey: "superAdmin.status.hold", color: "#8b5cf6" },
  { key: "approved", labelKey: "superAdmin.status.approved", color: "#22c55e" },
  { key: "rejected", labelKey: "superAdmin.status.rejected", color: "#ef4444" },
];

const STATUS_ICONS: Record<ShopRequestStatus, typeof Clock> = {
  pending: Clock,
  hold: Eye,
  approved: CheckCircle,
  rejected: XCircle,
};

const STATUS_COLORS: Record<ShopRequestStatus, { bg: string; fg: string }> = {
  pending: { bg: "rgba(245,158,11,0.1)", fg: "#f59e0b" },
  hold: { bg: "rgba(139,92,246,0.1)", fg: "#8b5cf6" },
  approved: { bg: "rgba(34,197,94,0.1)", fg: "#22c55e" },
  rejected: { bg: "rgba(239,68,68,0.1)", fg: "#ef4444" },
};

export default function SuperAdminDashboard() {
  const t = useT();
  const navigate = useNavigate();
  const { requests, loading, loadAllRequests, approveRequest, rejectRequest } = useShopRequestsStore();
  const { addToast } = useUIStore();
  const { user, logout } = useAuthStore();

  const [activeTab, setActiveTab] = useState<ShopRequestStatus | "all">("all");
  const [selectedRequest, setSelectedRequest] = useState<ShopRequest | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    loadAllRequests();
  }, []);

  const filteredRequests = activeTab === "all"
    ? requests
    : requests.filter((r) => r.status === activeTab);

  const counts = {
    all: requests.length,
    pending: requests.filter((r) => r.status === "pending").length,
    hold: requests.filter((r) => r.status === "hold").length,
    approved: requests.filter((r) => r.status === "approved").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
  };

  async function handleApprove(request: ShopRequest) {
    setActionLoading(true);
    try {
      const result = await approveRequest(request.id);
      if (result.success) {
        addToast(t("superAdmin.approvedToast", { shop: request.shopName }), "success");
        setSelectedRequest(null);
      } else {
        addToast(result.error || t("superAdmin.approveFailed"), "error");
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReject() {
    if (!selectedRequest) return;
    setActionLoading(true);
    try {
      const result = await rejectRequest(selectedRequest.id, rejectReason || undefined);
      if (result.success) {
        addToast(t("superAdmin.rejectedToast", { shop: selectedRequest.shopName }), "info");
        setSelectedRequest(null);
        setShowRejectModal(false);
        setRejectReason("");
      } else {
        addToast(result.error || t("superAdmin.rejectFailed"), "error");
      }
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />

      {/* Header */}
      <div className="px-4 pt-2 pb-3 flex items-center justify-between">
        <div>
          <p className="text-20 font-bold" style={{ color: "var(--text-primary)" }}>
            {t("superAdmin.shopRequests")}
          </p>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {t("superAdmin.subtitle")}
          </p>
        </div>
        <button
          onClick={() => { logout(); navigate("/login"); }}
          className="h-9 px-4 rounded-full text-xs font-bold"
          style={{ background: "var(--surface)", color: "var(--text-secondary)", border: "1px solid var(--divider)" }}
        >
          {t("superAdmin.logout")}
        </button>
      </div>

      {/* Status Tabs */}
      <div className="flex gap-2 px-4 pb-3 overflow-x-auto">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="flex items-center gap-1.5 h-8 px-4 rounded-full text-xs font-semibold shrink-0 transition-colors"
            style={{
              background: activeTab === tab.key ? "var(--brand)" : "var(--surface)",
              color: activeTab === tab.key ? "#0a0a0a" : "var(--text-secondary)",
              border: activeTab === tab.key ? "none" : "1px solid var(--divider)",
            }}
          >
            {t(tab.labelKey)}
            {counts[tab.key] > 0 && (
              <span
                className="ms-1 w-5 h-5 rounded-full text-10 flex items-center justify-center font-bold"
                style={{
                  background: activeTab === tab.key ? "rgba(0,0,0,0.15)" : "var(--divider)",
                }}
              >
                {counts[tab.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Request List */}
      <div className="flex flex-col px-4 gap-2 pb-24 flex-1">
        {loading && requests.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-[var(--brand)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="flex flex-col items-center py-16 gap-3">
            <Store size={40} style={{ color: "var(--text-secondary)" }} />
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {activeTab === "all"
                ? t("superAdmin.noRequests")
                : t("superAdmin.noFilteredRequests", {
                    tab: t(STATUS_TABS.find((s) => s.key === activeTab)?.labelKey ?? "superAdmin.tab.all").toLowerCase(),
                  })}
            </p>
          </div>
        ) : (
          filteredRequests.map((req) => {
            const StatusIcon = STATUS_ICONS[req.status];
            const statusColor = STATUS_COLORS[req.status];
            return (
              <button
                key={req.id}
                onClick={() => setSelectedRequest(req)}
                className="flex items-center gap-3 p-3 rounded-[var(--radius-card)] text-start transition-all active:scale-[0.98]"
                style={{ background: "var(--tone-card)" }}
              >
                {/* Shop Logo/Initials */}
                <div
                  className="w-12 h-12 rounded-[var(--radius-tile)] flex items-center justify-center text-lg font-bold shrink-0"
                  style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
                >
                  {req.shopName.charAt(0)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>
                    {req.shopName}
                  </p>
                  <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
                    {req.ownerName} · {req.ownerPhone}
                  </p>
                  <p className="text-10" style={{ color: "var(--text-secondary)" }}>
                    {new Date(req.createdAt).toLocaleDateString()}
                  </p>
                </div>

                {/* Status Badge */}
                <div
                  className="flex items-center gap-1.5 h-7 px-3 rounded-full shrink-0"
                  style={{ background: statusColor.bg }}
                >
                  <StatusIcon size={12} color={statusColor.fg} />
                  <span className="text-10 font-bold capitalize" style={{ color: statusColor.fg }}>
                    {t("superAdmin.status." + req.status)}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Request Detail Modal */}
      {selectedRequest && (
        <div
          className="fixed inset-0 z-50 flex items-end"
          style={{ background: "var(--scrim)" }}
          onClick={() => setSelectedRequest(null)}
        >
          <div
            className="w-full max-w-[480px] mx-auto rounded-t-[24px] p-6 flex flex-col gap-4 max-h-[80vh] overflow-y-auto"
            style={{ background: "var(--tone-sheet)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <p className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
                {t("superAdmin.shopRequest")}
              </p>
              <button onClick={() => setSelectedRequest(null)}>
                <XCircle size={20} style={{ color: "var(--text-secondary)" }} />
              </button>
            </div>

            {/* Shop Info */}
            <div className="flex flex-col gap-3">
              <InfoRow icon={Store} label={t("superAdmin.shop")} value={selectedRequest.shopName} />
              <InfoRow icon={User} label={t("superAdmin.owner")} value={selectedRequest.ownerName} />
              <InfoRow icon={User} label={t("common.phone")} value={selectedRequest.ownerPhone} />
              {selectedRequest.shopCity && (
                <InfoRow icon={MapPin} label={t("superAdmin.city")} value={selectedRequest.shopCity} />
              )}
              {selectedRequest.shopAddress && (
                <InfoRow icon={MapPin} label={t("common.address")} value={selectedRequest.shopAddress} />
              )}
              <InfoRow icon={Calendar} label={t("common.submitted")} value={new Date(selectedRequest.createdAt).toLocaleString()} />
            </div>

            {/* Rejection Reason */}
            {selectedRequest.status === "rejected" && selectedRequest.rejectionReason && (
              <div
                className="p-3 rounded-[var(--radius-tile)]"
                style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)" }}
              >
                <p className="text-xs font-bold mb-1" style={{ color: "#ef4444" }}>{t("admin.rejectionReason")}</p>
                <p className="text-sm" style={{ color: "var(--text-primary)" }}>{selectedRequest.rejectionReason}</p>
              </div>
            )}

            {/* Action Buttons */}
            {(selectedRequest.status === "pending" || selectedRequest.status === "hold") && (
              <div className="flex gap-3 mt-2">
                <button
                  onClick={() => setShowRejectModal(true)}
                  disabled={actionLoading}
                  className="flex-1 h-12 rounded-full font-bold text-sm flex items-center justify-center gap-2"
                  style={{ background: "var(--surface-2)", color: "#ef4444", border: "1px solid var(--divider)" }}
                >
                  <XCircle size={16} />
                  {t("superAdmin.reject")}
                </button>
                <button
                  onClick={() => handleApprove(selectedRequest)}
                  disabled={actionLoading}
                  className="flex-1 h-12 rounded-full font-bold text-sm flex items-center justify-center gap-2"
                  style={{ background: "var(--brand)", color: "#0a0a0a" }}
                >
                  {actionLoading ? (
                    <div className="w-4 h-4 border-2 border-border-control border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <CheckCircle size={16} />
                      {t("superAdmin.approve")}
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reject Reason Modal */}
      {showRejectModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "var(--scrim)" }}
          onClick={() => setShowRejectModal(false)}
        >
          <div
            className="w-full max-w-[360px] rounded-[var(--radius-card)] p-6 flex flex-col gap-4"
            style={{ background: "var(--tone-card)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
              {t("superAdmin.rejectRequest")}
            </p>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {t("superAdmin.rejectReasonHint")}
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t("superAdmin.rejectReasonPlaceholder")}
              rows={3}
              className="w-full rounded-[var(--radius-card)] p-3 text-sm outline-none resize-none"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--divider)",
                color: "var(--text-primary)",
              }}
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setShowRejectModal(false); setRejectReason(""); }}
                className="flex-1 h-10 rounded-full text-sm font-bold"
                style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleReject}
                disabled={actionLoading}
                className="flex-1 h-10 rounded-full text-sm font-bold"
                style={{ background: "#ef4444", color: "#fff" }}
              >
                {actionLoading ? t("superAdmin.rejecting") : t("superAdmin.confirmReject")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
        style={{ background: "var(--surface-2)" }}
      >
        <Icon size={14} style={{ color: "var(--text-secondary)" }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>{label}</p>
        <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{value}</p>
      </div>
    </div>
  );
}
