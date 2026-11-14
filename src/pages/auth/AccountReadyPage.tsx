import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Clipboard } from "lucide-react";
import AuthLayout from "@/components/layout/AuthLayout";
import StatusBar from "@/components/ui/StatusBar";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/lib/i18n";
import { getMyIdentity } from "@/lib/auth";

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
  const [agriId, setAgriId] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    void getMyIdentity().then((identity) => {
      if (alive && identity) setAgriId(identity.agriId);
    });
    return () => { alive = false; };
  }, [user]);

  async function copyAgriId() {
    if (!agriId) return;
    try {
      await navigator.clipboard.writeText(agriId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Selecting the value still works where the clipboard is blocked.
    }
  }

  const dest = "/login/business";

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
          {agriId && (
            <div
              className="w-full mt-6 rounded-[var(--radius-card)] px-4 py-3 text-start"
              style={{ background: "var(--surface-1)", border: "1px solid var(--divider)" }}
            >
              <p className="text-11 font-semibold tracking-wide" style={{ color: "var(--text-secondary)" }}>
                {t("identity.agriId")}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-20 font-bold tabular-nums flex-1" data-testid="account-ready-agri-id">
                  {agriId}
                </p>
                <button
                  type="button"
                  onClick={copyAgriId}
                  className="size-9 rounded-full flex items-center justify-center"
                  style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                  aria-label={t("identity.copy")}
                >
                  {copied ? <Check size={16} /> : <Clipboard size={16} />}
                </button>
              </div>
              <button
                type="button"
                onClick={() => navigate("/identity?setup=1")}
                className="text-12 font-semibold underline underline-offset-2 mt-2"
                style={{ color: "var(--brand-dark)" }}
              >
                {t("identity.setupAction")}
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 p-6">
          <button
            type="button"
            onClick={() => navigate("/login/pin-set", { replace: true, state: { returnTo: dest, celebrate: true } })}
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
