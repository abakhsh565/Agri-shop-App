import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import AuthLayout from "@/components/layout/AuthLayout";
import NavHeader from "@/components/ui/NavHeader";
import OTPInput from "@/components/ui/OTPInput";
import { verifyOTPAndResolveUser, sendOTP, SESSION_SETUP_FAILED } from "@/lib/auth";
import { DEMO_OTP_CODE, isDemoOtpMode } from "@/lib/authMode";
import { hasPin } from "@/lib/pinLock";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/lib/i18n";

const OTP_VALIDITY = 5 * 60;
// There is deliberately NO cap on tries and NO lockout. A shop owner or their
// new employee who mistypes a number must be able to keep trying — being shut
// out of their own shop for mistyping is far worse than the risk it guards
// against, and the code itself (later a real SMS code) is the gate. The only
// limit left is a short cooldown between texts, so "Resend" cannot be hammered.
const RESEND_DELAY = 30;
/** After this many wrong codes we suggest a fresh one instead of just saying no. */
const NUDGE_RESEND_AFTER = 3;

export default function OTPVerifyPage() {
  const navigate = useNavigate();
  const t = useT();
  const { pendingPhone, setUser } = useAuthStore();

  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [countdown, setCountdown] = useState(OTP_VALIDITY);
  const [resendCountdown, setResendCountdown] = useState(0);
  const verifying = useRef(false);

  useEffect(() => {
    if (!pendingPhone) navigate("/login", { replace: true });
  }, []);

  // SMS OTP auto-detection (Web OTP API — like WhatsApp)
  useEffect(() => {
    if (!pendingPhone || expired) return;
    // Only available in secure contexts (HTTPS or localhost)
    if (!window.navigator?.credentials?.get) return;

    const abortController = new AbortController();

    async function detectOTP() {
      try {
        const credential = await navigator.credentials.get({
          otp: { transport: ["sms"] },
          signal: abortController.signal,
        } as any);
        if (credential && (credential as any).code) {
          setOtp((credential as any).code);
        }
      } catch {
        // User denied or API not available — silent fallback
      }
    }

    detectOTP();
    return () => abortController.abort();
  }, [pendingPhone, countdown]);

  useEffect(() => {
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const t = setInterval(() => setResendCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCountdown]);

  function formatTime(s: number) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  async function handleVerify() {
    if (otp.length < 6) return;
    setLoading(true);
    setError("");
    try {
      const result = await verifyOTPAndResolveUser(pendingPhone, otp);

      if (result.status === "wrong_otp") {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        // Never "attempts remaining" — this person has as many tries as they need.
        setError(newAttempts >= NUDGE_RESEND_AFTER ? t("auth.codeWrongAgain") : t("auth.codeWrong"));
        setOtp("");
        return;
      }

      if (result.status === "not_registered") { navigate("/login/not-registered"); return; }
      if (result.status === "deactivated") { navigate("/login/deactivated"); return; }
      if (result.status === "pending") { navigate("/login/under-review"); return; }
      if (result.status === "rejected") { navigate("/login/rejected"); return; }
      if (result.status === "error") {
        setError(result.message === SESSION_SETUP_FAILED ? t("auth.sessionFailed") : result.message);
        setOtp("");
        return;
      }

      // status === "ok"
      setUser(result.user);
      // Check if user has a PIN set on this device
      if (!hasPin(result.user.id)) {
        // First time on this device — prompt to create PIN
        navigate("/login/pin-set", { replace: true });
      } else {
        const dest =
          result.user.role === "admin" || result.user.role === "co_admin"
            ? "/admin/dashboard"
            : "/employee/dashboard";
        navigate(dest, { replace: true });
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resendCountdown > 0) return;
    await sendOTP(pendingPhone);
    setResendCountdown(RESEND_DELAY);
    setCountdown(OTP_VALIDITY);
    setAttempts(0);
    setOtp("");
    setError("");
  }

  const expired = countdown === 0;

  // Auto-verify when 6 digits are entered (CR-026)
  useEffect(() => {
    if (otp.length === 6 && !expired && !loading && !verifying.current) {
      verifying.current = true;
      handleVerify().finally(() => { verifying.current = false; });
    }
  }, [otp, expired, loading]);

  return (
    <AuthLayout>
      <NavHeader title={t("auth.verifyOtp")} backTo="/login" />
      <div className="flex flex-col gap-8 p-6 flex-1">
        <div className="flex flex-col gap-2">
          <p className="text-xl font-bold text-black">{t("auth.enterCode")}</p>
          <p className="text-sm text-[#888]">
            {/* Demo mode has no SMS provider, so telling someone "we sent a code"
                would be false. The truth goes on screen instead. */}
            {isDemoOtpMode ? (
              t("auth.demoCodeHint", { code: DEMO_OTP_CODE })
            ) : (
              t("auth.codeSentToNumber", { phone: pendingPhone ?? "" })
            )}
          </p>
        </div>

        <OTPInput
          value={otp}
          onChange={(v) => { setOtp(v); setError(""); }}
          disabled={expired}
          error={!!error}
        />

        {error && <p className="text-sm text-[#ef4444] text-center">{error}</p>}

        {/* A partly typed code used to do nothing at all: submission waits for six
            numbers, so a short entry produced no error, no message and no submit —
            indistinguishable from a frozen screen. Say how many are still needed,
            in plain words. */}
        {!error && otp.length > 0 && otp.length < 6 && !expired && (
          <p className="text-sm text-[#888] text-center" data-testid="otp-incomplete">
            {t("auth.enterAllDigits", { count: 6 - otp.length })}
          </p>
        )}

        {!expired && (
          <p className="text-sm text-[#888] text-center">
            {t("auth.codeExpiresIn")}<span className="font-medium text-black">{formatTime(countdown)}</span>
          </p>
        )}

        {expired && (
          <p className="text-sm text-[#ef4444] text-center">{t("auth.codeExpired")}</p>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-3">
            <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-[#888]">{t("auth.verifying")}</p>
          </div>
        )}

        <div className="text-center">
          {resendCountdown > 0 ? (
            <p className="text-sm text-[#888]">{t("auth.resendIn", { seconds: resendCountdown })}</p>
          ) : (
            <button
              onClick={handleResend}
              className="text-sm font-medium text-black underline underline-offset-2"
            >
              {t("auth.resendOtp")}
            </button>
          )}
        </div>
      </div>
    </AuthLayout>
  );
}
