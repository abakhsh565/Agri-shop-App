import { useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import AuthLayout from "@/components/layout/AuthLayout";
import StatusBar from "@/components/ui/StatusBar";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/lib/i18n";

/**
 * The screen a **new** account lands on straight after the OTP: signed in, and one small thing
 * left to do.
 *
 * It exists because the old flow dropped a brand-new owner onto the PIN keypad with no
 * explanation — the first thing the app ever said to them was a security prompt. Here the step
 * is named, the account is acknowledged, and the PIN is explained as the convenience it is:
 * how they get back in next time without waiting for a code.
 *
 * The PIN is required before a protected workspace opens. This screen makes that requirement
 * explicit instead of offering a shortcut that the route guard would immediately reverse.
 */
export default function AccountReadyPage() {
  const t = useT();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  return (
    <AuthLayout>
      <StatusBar />
      <div className="flex flex-col flex-1 justify-between">
        <div className="flex flex-col items-center px-6 pt-10 text-center">
          <span
            className="size-16 rounded-full flex items-center justify-center"
            style={{ background: "color-mix(in srgb, var(--brand) 18%, transparent)" }}
          >
            <Check size={30} strokeWidth={2.5} style={{ color: "var(--brand-dark)" }} />
          </span>
          <p className="text-22 font-bold mt-5" style={{ color: "var(--text-primary)" }} data-testid="account-ready-title">
            {t("auth.readyTitle")}
          </p>
          <p className="text-14 mt-2 max-w-[300px]" style={{ color: "var(--text-secondary)" }} data-testid="account-ready-body">
            {t("auth.readyBody", { name: user?.name ?? "" })}
          </p>
        </div>

        <div className="flex flex-col gap-2 p-6">
          <button
            type="button"
            onClick={() => navigate("/login/pin-set", { replace: true, state: { celebrate: true } })}
            data-testid="account-ready-pin"
            className="ds-btn-brand w-full h-12 text-15 font-bold"
          >
            {t("auth.readyPrimary")}
          </button>
        </div>
      </div>
    </AuthLayout>
  );
}
