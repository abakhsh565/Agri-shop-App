import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import AuthLayout from "@/components/layout/AuthLayout";
import { useAuthStore } from "@/stores/authStore";
import { useShopRequestsStore } from "@/stores/shopRequestsStore";
import { normalizePhone } from "@/lib/auth";
import { Clock, CheckCircle, XCircle, RefreshCw } from "lucide-react";
import { useT } from "@/lib/i18n";

const STATUS_CONFIG = {
  pending: {
    icon: Clock,
    color: "#f59e0b",
    bgColor: "rgba(245,158,11,0.1)",
    title: "Registration Submitted",
    subtitle: "Your request is in the queue",
    description: "We've received your shop registration. Our team will review it shortly. You'll be notified once a decision is made.",
  },
  hold: {
    icon: RefreshCw,
    color: "#8b5cf6",
    bgColor: "rgba(139,92,246,0.1)",
    title: "On Hold",
    subtitle: "Your request needs more information",
    description: "Your registration has been put on hold. Please check with your shop admin for more details.",
  },
  approved: {
    icon: CheckCircle,
    color: "#22c55e",
    bgColor: "rgba(34,197,94,0.1)",
    title: "Approved!",
    subtitle: "Your shop has been approved",
    description: "Congratulations! Your shop registration has been approved. You can now log in and start using the app.",
  },
  rejected: {
    icon: XCircle,
    color: "#ef4444",
    bgColor: "rgba(239,68,68,0.1)",
    title: "Registration Rejected",
    subtitle: "Your request was not approved",
    description: "Unfortunately, your registration could not be approved. Please contact support for more information.",
  },
};

export default function RegisterStatusPage() {
  const t = useT();
  const navigate = useNavigate();
  const { pendingPhone } = useAuthStore();
  const { myRequest, loadMyRequest, loading } = useShopRequestsStore();

  useEffect(() => {
    if (pendingPhone) {
      loadMyRequest(normalizePhone(pendingPhone));
    }
    // Auto-refresh every 10 seconds to detect approval/rejection
    const interval = setInterval(() => {
      if (pendingPhone) loadMyRequest(normalizePhone(pendingPhone));
    }, 10000);
    return () => clearInterval(interval);
  }, [pendingPhone]);

  const status = myRequest?.status ?? "pending";
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <AuthLayout>
      <div className="flex flex-col flex-1 items-center justify-center p-6 gap-6">
        {/* Status Icon */}
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{ background: config.bgColor }}
        >
          <Icon size={40} color={config.color} />
        </div>

        {/* Status Text */}
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
            {config.title}
          </p>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {config.subtitle}
          </p>
        </div>

        {/* Description */}
        <p className="text-sm text-center max-w-[300px]" style={{ color: "var(--text-secondary)" }}>
          {config.description}
        </p>

        {/* Rejection Reason */}
        {status === "rejected" && myRequest?.rejectionReason && (
          <div
            className="w-full p-4 rounded-[14px]"
            style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            <p className="text-xs font-bold mb-1" style={{ color: "#ef4444" }}>{t("admin.reason")}:</p>
            <p className="text-sm" style={{ color: "var(--text-primary)" }}>{myRequest.rejectionReason}</p>
          </div>
        )}

        {/* Shop Info */}
        {myRequest && (
          <div
            className="w-full p-4 rounded-[14px]"
            style={{ background: "var(--surface)" }}
          >
            <p className="text-xs font-bold mb-3" style={{ color: "var(--text-secondary)" }}>
              {t("register.details")}
            </p>
            <div className="flex flex-col gap-2">
              <div className="flex justify-between">
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("common.shopName")}</span>
                <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{myRequest.shopName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("settings.owner")}</span>
                <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{myRequest.ownerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("addEmployee.labelPhone")}</span>
                <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{myRequest.ownerPhone}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("common.submitted")}</span>
                <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  {new Date(myRequest.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-3 w-full mt-4">
          {status === "approved" && (
            <button
              onClick={() => navigate("/login")}
              className="w-full h-12 rounded-full font-bold text-sm"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              {t("register.loginToShop")}
            </button>
          )}

          {status === "rejected" && (
            <button
              onClick={() => navigate("/register")}
              className="w-full h-12 rounded-full font-bold text-sm"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              {t("common.tryAgain")}
            </button>
          )}

          {(status === "pending" || status === "hold") && (
            <button
              onClick={() => loadMyRequest(normalizePhone(pendingPhone))}
              className="w-full h-12 rounded-full font-bold text-sm flex items-center justify-center gap-2"
              style={{ background: "var(--surface)", color: "var(--text-primary)", border: "1px solid var(--divider)" }}
            >
              <RefreshCw size={16} />
              {t("register.refreshStatus")}
            </button>
          )}

          <button
            onClick={() => navigate("/login")}
            className="w-full h-12 rounded-full font-bold text-sm"
            style={{ background: "transparent", color: "var(--text-secondary)" }}
          >
            {t("auth.backToLogin")}
          </button>
        </div>
      </div>
    </AuthLayout>
  );
}
