import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import AuthLayout from "@/components/layout/AuthLayout";
import NavHeader from "@/components/ui/NavHeader";
import OTPInput from "@/components/ui/OTPInput";
import { verifyOTPAndResolveUser, sendOTP, normalizePhone, SESSION_SETUP_FAILED } from "@/lib/auth";
import Button from "@/components/ui/Button";
import { useAuthStore } from "@/stores/authStore";
import { useShopRequestsStore } from "@/stores/shopRequestsStore";
import { useT } from "@/lib/i18n";

const OTP_VALIDITY = 2 * 60;
const RESEND_DELAY = 30;

export default function RegisterOTPPage() {
  const t = useT();
  const navigate = useNavigate();
  const { pendingPhone } = useAuthStore();
  const { myRequest, loadMyRequest } = useShopRequestsStore();

  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [wrongTries, setWrongTries] = useState(0);
  // Set when the code proves a number that already has an account: signup is refused
  // (signing them in here would skip the PIN step), and the way in is offered instead.
  const [takenAs, setTakenAs] = useState<"owner" | "employee" | null>(null);
  const [countdown, setCountdown] = useState(OTP_VALIDITY);
  // Starts at the cooldown, not at zero: a code was just sent, so Resend arrives disabled and
  // becomes usable 30 seconds later.
  const [resendCountdown, setResendCountdown] = useState(RESEND_DELAY);
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

  function formatTime(s: number) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  async function handleVerify() {
    if (otp.length < 6) return;
    setLoading(true);
    setError("");
    try {
      const normalized = normalizePhone(pendingPhone);
      const result = await verifyOTPAndResolveUser(pendingPhone, otp);

      if (result.status === "wrong_otp") {
        // A person may write the code as many times as they need — there is no
        // lockout. After a few wrong tries the message stops counting and points at
        // the useful action instead (same rule as the sign-in code screen).
        const tries = wrongTries + 1;
        setWrongTries(tries);
        setError(t(tries >= 3 ? "auth.codeWrongAgain" : "auth.codeWrong"));
        setOtp("");
        return;
      }

      if (result.status === "ok") {
        // A number that already has an account is not a signup. Signing it in from the
        // registration screen skipped the PIN step, so it is refused and the person is
        // pointed at sign-in — where the PIN lives.
        setTakenAs(result.user.role === "employee" ? "employee" : "owner");
        setOtp("");
        return;
      }

      if (result.status === "deactivated") { navigate("/login/deactivated", { replace: true }); return; }
      if (result.status === "rejected") { navigate("/login/rejected", { replace: true }); return; }
      if (result.status === "pending") { navigate("/register/status", { replace: true }); return; }
      if (result.status === "error") {
        setError(result.message === SESSION_SETUP_FAILED ? t("auth.sessionFailed") : result.message);
        setOtp("");
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

    if (resendCountdown > 0) return;
    await sendOTP(pendingPhone);
    setResendCountdown(RESEND_DELAY);
    setCountdown(OTP_VALIDITY);
    setWrongTries(0);
    setOtp("");
    setError("");
  }

  const expired = countdown === 0;

  // Auto-verify when 6 digits are entered
  useEffect(() => {
    if (otp.length === 6 && !expired && !loading && !verifying.current) {
      verifying.current = true;
      handleVerify().finally(() => { verifying.current = false; });
    }
  }, [otp, expired, loading]);

  return (
    <AuthLayout>
      <NavHeader title={t("auth.verifyPhone")} backTo="/register" />
      {/* Same rule as the sign-in code screen: centred in the space that is left, nothing larger
          than the boxes as a gap, so the code, the clock and Resend all stay visible with the
          keyboard open on a small phone. */}
      <div className="flex flex-col justify-center gap-5 px-6 py-4 flex-1 min-h-0">
        <div className="flex flex-col gap-2">
          <p className="text-xl font-bold text-foreground">{t("auth.enterCode")}</p>
          {/* The link sits on the same line as the number it changes. */}
          <p className="text-sm text-caption">
            {t("auth.otpSentToNumber", { phone: pendingPhone ?? "" })}{" "}
            <button
              type="button"
              onClick={() => navigate("/register")}
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

        {takenAs && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[#ef4444] text-center">
              {t(takenAs === "employee" ? "auth.employeeNumberTaken" : "auth.phoneTaken")}
            </p>
            <Button fullWidth onClick={() => navigate("/login")}>{t("auth.signIn")}</Button>
          </div>
        )}

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
