import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthLayout from "@/components/layout/AuthLayout";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import OTPInput from "@/components/ui/OTPInput";
import {
  recoverWithKey,
  requestPhoneChange,
  completePhoneChange,
} from "@/lib/auth";
import type { User } from "@/types";
import { markPhoneVerified, rememberLastProfile } from "@/lib/loginWindow";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/lib/i18n";

type Step = "identify" | "phone" | "otp";

/**
 * The recovery door for a forgotten number or a lost SIM.
 *
 * The recovery key is checked by the database against its own bcrypt hash. The Agri ID can
 * locate the account, but on its own it opens nothing. Once the key is verified the SAME
 * user id and auth identity are resumed, so memberships, shops, roles, branches and history
 * are untouched. Only then is a replacement phone confirmed and written.
 */
export default function AccountRecoveryPage() {
  const t = useT();
  const navigate = useNavigate();
  const { setUser } = useAuthStore();

  const [step, setStep] = useState<Step>("identify");
  const [agriId, setAgriId] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [user, setRecoveredUser] = useState<User | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const verifying = useRef(false);

  function validPhone(value: string): boolean {
    const clean = value.replace(/\s/g, "");
    return /^0\d{9,10}$/.test(clean) || /^92\d{10,11}$/.test(clean);
  }

  async function handleVerifyKey() {
    if (!recoveryKey.trim() || loading) return;
    setLoading(true);
    setError("");
    try {
      const result = await recoverWithKey(agriId, recoveryKey);
      if (result.status === "invalid") { setError(t("recovery.invalid")); return; }
      if (result.status === "locked") { setError(t("recovery.locked")); return; }
      if (result.status === "inactive") { setError(t("recovery.inactive")); return; }
      if (result.status === "login_not_ready") { setError(t("recovery.loginNotReady")); return; }
      if (result.status === "unsupported") { setError(t("recovery.unavailable")); return; }
      if (result.status === "error") { setError(t("auth.checkFailed")); return; }
      setRecoveredUser(result.user);
      setUser(result.user);
      setAgriId(result.agriId);
      setStep("phone");
    } finally {
      setLoading(false);
    }
  }

  async function handleSendCode() {
    if (!validPhone(newPhone)) { setError(t("auth.errPhoneFormat")); return; }
    setLoading(true);
    setError("");
    try {
      const result = await requestPhoneChange(newPhone);
      if (!result.success) { setError(t("auth.errSendCode")); return; }
      setOtp("");
      setStep("otp");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(code: string) {
    if (code.length < 6 || !user || loading) return;
    setLoading(true);
    setError("");
    try {
      const result = await completePhoneChange(newPhone, code);
      if (result.status === "wrong_code") { setError(t("recovery.codeWrong")); setOtp(""); return; }
      if (result.status === "taken") { setError(t("recovery.taken")); return; }
      if (result.status === "invalid") { setError(t("recovery.invalidPhone")); return; }
      if (result.status === "not_verified") { setError(t("recovery.codeWrong")); return; }
      if (result.status === "error") { setError(t("recovery.saveFailed")); return; }
      if (result.status === "unchanged") {
        // The number already belongs to this identity. The recovery was still a success; let
        // the person set a fresh PIN and continue without inventing a change.
        navigate("/login/pin-set", {
          replace: true,
          state: { returnTo: "/login/business", celebrate: true },
        });
        return;
      }

      const nextUser: User = { ...user, phone: result.phone };
      setUser(nextUser);
      await rememberLastProfile(nextUser);
      await markPhoneVerified(nextUser.id);
      navigate("/login/pin-set", {
        replace: true,
        state: { returnTo: "/login/business", celebrate: true },
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <NavHeader title={t("recovery.title")} backTo="/login" />
      <div className="flex flex-col flex-1 gap-5 px-6 py-5 overflow-y-auto">
        {step === "identify" && (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-20 font-bold" style={{ color: "var(--text-primary)" }}>
                {t("recovery.subtitle")}
              </p>
              <p className="text-13" style={{ color: "var(--text-secondary)" }}>
                {t("recovery.keyWarning")}
              </p>
            </div>
            <Input
              label={t("recovery.agriId")}
              placeholder={t("recovery.agriIdPlaceholder")}
              value={agriId}
              onChange={(e) => { setAgriId(e.target.value); setError(""); }}
              hint={t("recovery.agriIdHint")}
              autoCapitalize="characters"
              autoComplete="off"
            />
            <Input
              label={t("recovery.key")}
              placeholder={t("recovery.keyPlaceholder")}
              value={recoveryKey}
              onChange={(e) => { setRecoveryKey(e.target.value); setError(""); }}
              hint={t("recovery.keyHint")}
              autoCapitalize="characters"
              autoComplete="off"
              error={error}
              onKeyDown={(e) => e.key === "Enter" && handleVerifyKey()}
            />
            <Button
              fullWidth
              size="lg"
              onClick={handleVerifyKey}
              loading={loading}
              disabled={!recoveryKey.trim()}
            >
              {t("recovery.verify")}
            </Button>
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="text-13 underline underline-offset-2 self-center"
              style={{ color: "var(--text-secondary)" }}
            >
              {t("auth.backToLogin")}
            </button>
          </>
        )}

        {step === "phone" && user && (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-20 font-bold" style={{ color: "var(--text-primary)" }}>
                {t("recovery.verifiedTitle")}
              </p>
              <p className="text-13" style={{ color: "var(--text-secondary)" }}>
                {t("recovery.verifiedBody", { name: user.name })}
              </p>
            </div>
            <div
              className="rounded-[var(--radius-card)] px-4 py-3"
              style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
            >
              <p className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>
                {t("identity.agriId")}
              </p>
              <p className="text-17 font-bold mt-1 tabular-nums" style={{ color: "var(--text-primary)" }}>
                {agriId}
              </p>
            </div>
            <p className="text-14 font-semibold" style={{ color: "var(--text-primary)" }}>
              {t("recovery.newPhoneTitle")}
            </p>
            <p className="text-13" style={{ color: "var(--text-secondary)" }}>
              {t("recovery.newPhoneBody")}
            </p>
            <Input
              label={t("recovery.newPhone")}
              type="tel"
              placeholder={t("common.phonePlaceholder")}
              value={newPhone}
              onChange={(e) => { setNewPhone(e.target.value.replace(/\D/g, "")); setError(""); }}
              error={error}
              autoComplete="tel"
              onKeyDown={(e) => e.key === "Enter" && handleSendCode()}
            />
            <Button
              fullWidth
              size="lg"
              onClick={handleSendCode}
              loading={loading}
              disabled={!newPhone}
            >
              {t("recovery.sendCode")}
            </Button>
          </>
        )}

        {step === "otp" && (
          <>
            <div className="flex flex-col gap-2 text-center">
              <p className="text-20 font-bold" style={{ color: "var(--text-primary)" }}>
                {t("recovery.codeTitle")}
              </p>
              <p className="text-13" style={{ color: "var(--text-secondary)" }}>
                {t("recovery.codeBody", { phone: newPhone })}
              </p>
            </div>
            <OTPInput
              value={otp}
              onChange={(value) => {
                setOtp(value);
                setError("");
                if (value.length === 6 && !verifying.current) {
                  verifying.current = true;
                  void handleVerifyCode(value).finally(() => { verifying.current = false; });
                }
              }}
              error={!!error}
            />
            {error && <p className="text-13 text-center" style={{ color: "var(--error)" }}>{error}</p>}
            {loading && (
              <p className="text-13 text-center" style={{ color: "var(--text-secondary)" }}>
                {t("recovery.savingPhone")}
              </p>
            )}
          </>
        )}
      </div>
    </AuthLayout>
  );
}
