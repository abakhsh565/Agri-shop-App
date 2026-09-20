import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import AuthLayout from "@/components/layout/AuthLayout";
import NavHeader from "@/components/ui/NavHeader";
import OTPInput from "@/components/ui/OTPInput";
import Button from "@/components/ui/Button";
import { verifyOTPAndResolveUser, sendOTP, SESSION_SETUP_FAILED } from "@/lib/auth";
import { hasPin } from "@/lib/pinLock";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/lib/i18n";

const OTP_VALIDITY = 5 * 60;
const MAX_ATTEMPTS = 5;
const MAX_RESENDS = 3;
const RESEND_DELAY = 30;

export default function OTPVerifyPage() {
  const navigate = useNavigate();
  const t = useT();
  const { pendingPhone, setUser } = useAuthStore();

  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [resends, setResends] = useState(0);
  const [countdown, setCountdown] = useState(OTP_VALIDITY);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [locked, setLocked] = useState(false);
  const [lockTime, setLockTime] = useState(0);
  const verifying = useRef(false);

  useEffect(() => {
    if (!pendingPhone) navigate("/login", { replace: true });
  }, []);

  // SMS OTP auto-detection (Web OTP API — like WhatsApp)
  useEffect(() => {
    if (!pendingPhone || locked || expired) return;
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
  }, [pendingPhone, locked, countdown]);

  useEffect(() => {
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const t = setInterval(() => setResendCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCountdown]);

  useEffect(() => {
    if (lockTime <= 0) return;
    const t = setInterval(() => {
      setLockTime((c) => {
        if (c <= 1) { setLocked(false); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [lockTime]);

  function formatTime(s: number) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  async function handleVerify() {
    if (locked || otp.length < 6) return;
    setLoading(true);
    setError("");
    try {
      const result = await verifyOTPAndResolveUser(pendingPhone, otp);

      if (result.status === "wrong_otp") {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        if (newAttempts >= MAX_ATTEMPTS) {
          setLocked(true);
          setLockTime(10 * 60);
          setError(`Too many incorrect attempts. Try again in 10 minutes.`);
        } else {
          setError(`Incorrect code. ${MAX_ATTEMPTS - newAttempts} attempts remaining.`);
        }
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
    if (resends >= MAX_RESENDS) return;
    if (resendCountdown > 0) return;
    await sendOTP(pendingPhone);
    setResends((r) => r + 1);
    setResendCountdown(RESEND_DELAY);
    setCountdown(OTP_VALIDITY);
    setAttempts(0);
    setOtp("");
    setError("");
  }

  const expired = countdown === 0;

  // Auto-verify when 6 digits are entered (CR-026)
  useEffect(() => {
    if (otp.length === 6 && !locked && !expired && !loading && !verifying.current) {
      verifying.current = true;
      handleVerify().finally(() => { verifying.current = false; });
    }
  }, [otp, locked, expired, loading]);

  return (
    <AuthLayout>
      <NavHeader title={t("auth.verifyOtp")} backTo="/login" />
      <div className="flex flex-col gap-8 p-6 flex-1">
        <div className="flex flex-col gap-2">
          <p className="text-xl font-bold text-black">{t("auth.enterCode")}</p>
          <p className="text-sm text-[#888]">
            We sent a 6-digit code to{" "}
            <span className="font-medium text-black">{pendingPhone}</span>
          </p>
        </div>

        <OTPInput
          value={otp}
          onChange={(v) => { setOtp(v); setError(""); }}
          disabled={locked || expired}
          error={!!error}
        />

        {error && <p className="text-sm text-[#ef4444] text-center">{error}</p>}

        {!expired && !locked && (
          <p className="text-sm text-[#888] text-center">
            {t("auth.codeExpiresIn")}<span className="font-medium text-black">{formatTime(countdown)}</span>
          </p>
        )}

        {expired && !locked && (
          <p className="text-sm text-[#ef4444] text-center">{t("auth.codeExpired")}</p>
        )}

        {locked && (
          <p className="text-sm text-[#ef4444] text-center">
            Too many attempts. Try again in {formatTime(lockTime)}.
          </p>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-3">
            <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-[#888]">{t("auth.verifying")}</p>
          </div>
        )}

        <div className="text-center">
          {resendCountdown > 0 ? (
            <p className="text-sm text-[#888]">Resend in {resendCountdown}s</p>
          ) : resends >= MAX_RESENDS ? (
            <p className="text-sm text-[#ef4444]">{t("auth.resendLimit")}</p>
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
