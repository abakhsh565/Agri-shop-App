import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import AuthLayout from "@/components/layout/AuthLayout";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { sendOTP, checkPhoneRegistration } from "@/lib/auth";
import { rememberInviteShop } from "@/lib/appInvite";
import { isDemoOtpMode } from "@/lib/authMode";
import { lastUsedProfile } from "@/lib/loginWindow";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/lib/i18n";

/**
 * ONE PHONE DOOR.
 *
 * There is no owner/employee choice. The number is the only question, the server resolves the
 * account and every membership it holds, and the OTP proves possession. A forgotten number is
 * recovered from the separate recovery door below the field; a forgotten PIN belongs to the
 * PIN screen, not here.
 */
export default function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { setPendingPhone, setPendingFlow, setIsNewDevice } = useAuthStore();

  // An invitation link still prefills the number it was sent to. The pending membership is what
  // carries the invitation; the shop is no longer a login question.
  const [searchParams] = useSearchParams();
  const invitedPhone = (searchParams.get("phone") ?? "").replace(/\s/g, "");
  const reverify = (location.state as { reverify?: boolean } | null)?.reverify === true;

  const [phone, setPhone] = useState(invitedPhone);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    if (!reverify || invitedPhone) return;
    let alive = true;
    void lastUsedProfile().then((last) => {
      if (!alive || !last) return;
      const stored = last.user.phone;
      setPhone(/^92\d{10}$/.test(stored) ? "0" + stored.slice(2) : stored);
    });
    return () => { alive = false; };
  }, [reverify, invitedPhone]);

  function validPhone(value: string): boolean {
    const clean = value.replace(/\s/g, "");
    return /^0\d{9,10}$/.test(clean) || /^92\d{10,11}$/.test(clean);
  }

  async function handleSignIn() {
    if (submitting.current) return;
    submitting.current = true;
    setError("");
    setLoading(true);
    try {
      const cleanPhone = phone.replace(/\s/g, "");
      if (!validPhone(cleanPhone)) {
        setError(t("auth.errPhoneFormat"));
        return;
      }

      const check = await checkPhoneRegistration(cleanPhone);
      if (check.status === "error") {
        setError(t("auth.checkFailed"));
        return;
      }
      if (check.status !== "registered") {
        setPendingPhone(cleanPhone);
        if (check.status === "unregistered") { navigate("/login/not-registered"); return; }
        if (check.status === "pending") { navigate("/login/under-review"); return; }
        if (check.status === "rejected") { navigate("/login/rejected"); return; }
        navigate("/login/deactivated");
        return;
      }

      // A stale invitation claim from an earlier attempt must not be rechecked at the code
      // screen. Pending memberships are now the only invitation source.
      rememberInviteShop(null);
      setPendingPhone(cleanPhone);
      setPendingFlow("login");
      setIsNewDevice(true);
      const sent = await sendOTP(cleanPhone);
      if (!sent.success) {
        setError(sent.error || t("auth.errSendCode"));
        return;
      }
      navigate("/login/otp");
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <div className="flex flex-col flex-1 justify-between">
        <div className="flex flex-col gap-6 p-6">
          <div className="flex flex-col gap-2">
            <p className="text-26 font-bold" style={{ color: "var(--text-primary)" }}>
              {t("auth.welcomeBack")}
            </p>
            <p className="text-14" style={{ color: "var(--text-secondary)" }}>
              {t("auth.enterPhoneOwner")}
            </p>
          </div>

          {reverify && (
            <div
              className="rounded-[var(--radius-tile)] px-3 py-2"
              style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
              data-testid="reverify-hint"
            >
              <p className="text-12" style={{ color: "var(--text-secondary)" }}>
                {t("auth.reverifyReason")}
              </p>
            </div>
          )}

          {invitedPhone && (
            <div
              className="rounded-[var(--radius-tile)] px-3 py-2"
              style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
            >
              <p className="text-12" style={{ color: "var(--text-secondary)" }}>
                {t("auth.invitedPhoneNote")}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <Input
              label={t("auth.phoneNumber")}
              type="tel"
              placeholder={t("common.phonePlaceholder")}
              value={phone}
              onChange={(e) => { setPhone(e.target.value.replace(/\D/g, "")); setError(""); }}
              error={error}
              hint={isDemoOtpMode ? t("auth.codeHintDemo") : t("auth.codeHint")}
              autoComplete="tel"
              onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
            />
            <button
              type="button"
              onClick={() => navigate("/login/recover")}
              className="text-13 font-semibold text-start underline underline-offset-2 self-start"
              style={{ color: "var(--text-secondary)" }}
            >
              {t("auth.forgotNumber")}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-4 p-6">
          <Button
            fullWidth
            size="lg"
            onClick={handleSignIn}
            loading={loading}
            disabled={!phone.trim()}
          >
            {t("auth.sendCode")}
          </Button>
          <p className="text-xs text-center" style={{ color: "var(--text-tertiary)" }}>
            {t("auth.newShopOwner")}{" "}
            <button
              type="button"
              onClick={() => navigate("/register")}
              className="font-semibold underline underline-offset-2"
              style={{ color: "var(--brand-dark)" }}
            >
              {t("auth.registerShop")}
            </button>
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
