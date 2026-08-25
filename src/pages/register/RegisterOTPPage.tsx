import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import AuthLayout from "@/components/layout/AuthLayout";
import NavHeader from "@/components/ui/NavHeader";
import OTPInput from "@/components/ui/OTPInput";
import { verifyOTPAndResolveUser, sendOTP, normalizePhone } from "@/lib/auth";
import { useAuthStore } from "@/stores/authStore";
import { useShopRequestsStore } from "@/stores/shopRequestsStore";

const OTP_VALIDITY = 5 * 60;
const MAX_ATTEMPTS = 5;
const MAX_RESENDS = 3;
const RESEND_DELAY = 30;

export default function RegisterOTPPage() {
  const navigate = useNavigate();
  const { pendingPhone, setUser } = useAuthStore();
  const { myRequest, loadMyRequest } = useShopRequestsStore();

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
    if (!pendingPhone) navigate("/register", { replace: true });
  }, []);

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
      const normalized = normalizePhone(pendingPhone);
      const result = await verifyOTPAndResolveUser(pendingPhone, otp);

      if (result.status === "wrong_otp") {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        if (newAttempts >= MAX_ATTEMPTS) {
          setLocked(true);
          setLockTime(10 * 60);
          setError("Too many incorrect attempts. Try again in 10 minutes.");
        } else {
          setError(`Incorrect code. ${MAX_ATTEMPTS - newAttempts} attempts remaining.`);
        }
        setOtp("");
        return;
      }

      if (result.status === "ok") {
        // User already exists as admin - go to their dashboard
        setUser(result.user);
        const dest = result.user.role === "admin" ? "/admin/dashboard" : "/employee/dashboard";
        navigate(dest, { replace: true });
        return;
      }

      // User doesn't exist yet - check if they have a pending shop request
      await loadMyRequest(normalized);

      if (myRequest) {
        // They have an existing request - show status
        navigate("/register/status", { replace: true });
        return;
      }

      // New registration - go to shop details form
      navigate("/register/shop-details", { replace: true });
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

  // Auto-verify when 6 digits are entered
  useEffect(() => {
    if (otp.length === 6 && !locked && !expired && !loading && !verifying.current) {
      verifying.current = true;
      handleVerify().finally(() => { verifying.current = false; });
    }
  }, [otp, locked, expired, loading]);

  return (
    <AuthLayout>
      <NavHeader title="Verify Phone" backTo="/register" />
      <div className="flex flex-col gap-8 p-6 flex-1">
        <div className="flex flex-col gap-2">
          <p className="text-xl font-bold text-black">Enter verification code</p>
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
            Code expires in <span className="font-medium text-black">{formatTime(countdown)}</span>
          </p>
        )}

        {expired && !locked && (
          <p className="text-sm text-[#ef4444] text-center">Code expired. Request a new one.</p>
        )}

        {locked && (
          <p className="text-sm text-[#ef4444] text-center">
            Too many attempts. Try again in {formatTime(lockTime)}.
          </p>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-3">
            <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-[#888]">Verifying...</p>
          </div>
        )}

        <div className="text-center">
          {resendCountdown > 0 ? (
            <p className="text-sm text-[#888]">Resend in {resendCountdown}s</p>
          ) : resends >= MAX_RESENDS ? (
            <p className="text-sm text-[#ef4444]">Maximum resend attempts reached.</p>
          ) : (
            <button
              onClick={handleResend}
              className="text-sm font-medium text-black underline underline-offset-2"
            >
              Resend OTP
            </button>
          )}
        </div>
      </div>
    </AuthLayout>
  );
}
