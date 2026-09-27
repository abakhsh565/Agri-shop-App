import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import AuthLayout from "@/components/layout/AuthLayout";
import NavHeader from "@/components/ui/NavHeader";
import OTPInput from "@/components/ui/OTPInput";
import { verifyOTPAndResolveUser, sendOTP, SESSION_SETUP_FAILED } from "@/lib/auth";
import { hasPin } from "@/lib/pinLock";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/lib/i18n";

const OTP_VALIDITY = 2 * 60;
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
  // Starts at the cooldown, not at zero: a code was just sent, so Resend arrives disabled and
  // becomes usable 30 seconds later — the same wait the person gets after pressing it.
  const [resendCountdown, setResendCountdown] = useState(RESEND_DELAY);
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
      //
      // Where the code lands depends on who this is, which is the difference the flow was
      // missing:
      //
      //   • **never signed in before** (`firstLoginAt` null) — a brand-new account. They get the
      //     account-ready screen, which says they are in and offers the PIN as the next small
      //     step. Dropping them straight onto a keypad made a security prompt the first thing
      //     the app ever said to them.
      //   • **known account, new device** (no PIN here yet) — no celebration, because nothing
      //     was created: straight to setting the PIN this device will use.
      //   • **known account with a PIN here** — straight in.
      //
      // The code itself is identity verification, used once per device: from then on the PIN is
      // the everyday way back in, which is why opening the app does not ask for another one.
      const isBrandNewAccount = !result.user.firstLoginAt;
      const dest =
        result.user.role === "admin" || result.user.role === "co_admin"
          ? "/admin/dashboard"
          : "/employee/dashboard";
      if (!hasPin(result.user.id)) {
        // `returnTo` is what tells PINSetPage this is a like-for-like swap rather than a first
        // PIN: without it a returning user on a new phone was congratulated for creating nothing.
        navigate(isBrandNewAccount ? "/login/account-ready" : "/login/pin-set", {
          replace: true,
          state: isBrandNewAccount ? undefined : { returnTo: dest },
        });
      } else {
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
      {/* Centred in whatever height is left, with no fixed gap bigger than the code boxes:
          returning here after the session has expired means the number is already filled in and
          the keyboard is open, so the boxes have to stay in view with ~40% less height than the
          screen. Everything on this screen is sized by the type scale and the space tokens —
          nothing needs to scroll at phone sizes. */}
      <div className="flex flex-col justify-center gap-5 px-6 py-4 flex-1 min-h-0">
        <div className="flex flex-col gap-2">
          <p className="text-xl font-bold text-foreground">{t("auth.enterCode")}</p>
          {/* The link sits on the same line as the number it changes, so "which number" and
              "not that one" are read together. */}
          <p className="text-sm text-caption">
            {t("auth.otpSentToNumber", { phone: pendingPhone ?? "" })}{" "}
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="font-medium text-foreground underline underline-offset-2"
            >
              {t("auth.changeNumber")}
            </button>
          </p>
        </div>

        <OTPInput
          value={otp}
          onChange={(v) => { setOtp(v); setError(""); }}
          disabled={expired}
          error={!!error}
        />

        {error && <p className="text-sm text-[#ef4444] text-center">{error}</p>}

        {expired && (
          <p className="text-sm text-[#ef4444] text-center">{t("auth.codeExpired")}</p>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-3">
            <div className="w-5 h-5 border-2 border-border-control border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-caption">{t("auth.verifying")}</p>
          </div>
        )}

        {/* The time left and the way to get a new code sit together: one row, no sentence
            explaining either. Resend is present the whole time and only becomes usable when
            the 30-second cooldown ends. */}
        <div className="flex items-center justify-center gap-3">
          <span className="text-sm font-medium tabular-nums text-foreground">{formatTime(countdown)}</span>
          <button
            type="button"
            onClick={handleResend}
            disabled={resendCountdown > 0}
            className="text-sm font-medium text-foreground underline underline-offset-2 disabled:opacity-40 disabled:no-underline"
          >
            {t("auth.resendOtp")}
          </button>
        </div>
      </div>
    </AuthLayout>
  );
}
