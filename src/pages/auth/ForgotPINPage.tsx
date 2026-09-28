import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import AuthLayout from "@/components/layout/AuthLayout";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import OTPInput from "@/components/ui/OTPInput";
import PINInput from "@/components/ui/PINInput";
import { sendOTP, verifyOTPAndResolveUser, SESSION_SETUP_FAILED } from "@/lib/auth";
import { savePin } from "@/lib/pinLock";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types";
import { useT } from "@/lib/i18n";

type Step = "phone" | "otp" | "pin" | "confirm";

/**
 * Forgot PIN flow — 2-step when user comes from PINLoginPage:
 * 1. Verify OTP (phone pre-filled)
 * 2. Set + Confirm new PIN → Dashboard
 *
 * 3-step when accessed directly:
 * 1. Enter phone
 * 2. Verify OTP
 * 3. Set + Confirm new PIN → Dashboard
 */
export default function ForgotPINPage() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { setUser, setPendingPhone, setPendingFlow, pendingPhone } = useAuthStore();

  // User passed from PINLoginPage (skip phone entry)
  const routeUser = (location.state as { user?: User } | null)?.user;

  const [step, setStep] = useState<Step>(routeUser ? "otp" : "phone");
  const [phone, setPhone] = useState(routeUser?.phone || pendingPhone || "");
  const [otp, setOtp] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  // Set while a code is being checked, so the same six digits cannot be submitted twice by the
  // effect below re-running on a re-render.
  const verifying = useRef(false);

  useEffect(() => {
    if (!routeUser && !pendingPhone) {
      // No context — stay on phone step
    }
  }, []);

  async function handleSendOTP() {
    if (!phone.trim()) { setError(t("copy.enterPhone")); return; }
    setLoading(true);
    setError("");
    try {
      setPendingPhone(phone.trim());
      await sendOTP(phone.trim());
      setStep("otp");
    } catch {
      setError(t("copy.sendCodeFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOTP() {
    if (otp.length < 6) return;
    setLoading(true);
    setError("");
    try {
      const result = await verifyOTPAndResolveUser(phone, otp);
      if (result.status === "wrong_otp") { setError(t("auth.codeWrong")); setOtp(""); return; }
      if (result.status === "not_registered") { setError(t("auth.numberNotRegistered")); return; }
      if (result.status === "deactivated") { setError(t("copy.accountDeactivated")); return; }
      if (result.status === "pending") { setError(t("auth.underReview")); return; }
      if (result.status === "rejected") { setError(t("auth.rejected")); return; }
      // An invited number whose sign-in was never provisioned, and a number that belongs to a
      // different shop, both need the owner — say which, instead of a code error.
      if (result.status === "login_not_ready") { setError(t("auth.loginNotReady")); return; }
      if (result.status === "wrong_invite") { setError(t("auth.errNotInvited", { shop: result.shopName })); return; }
      // A failed session setup has its own sentence; showing the internal marker instead would
      // tell someone their account is broken in words they cannot act on.
      if (result.status === "error") {
        setError(result.message === SESSION_SETUP_FAILED ? t("auth.sessionFailed") : result.message);
        return;
      }
      // OTP correct — set user and go to PIN creation
      setUser(result.user);
      setStep("pin");
    } finally {
      setLoading(false);
    }
  }

  // Auto-verify once all six digits are in — the same rule the sign-in code screen follows, so
  // the sixth digit is the submit here too. The ref stops a re-render from checking the same
  // code a second time.
  useEffect(() => {
    if (step === "otp" && otp.length === 6 && !loading && !verifying.current) {
      verifying.current = true;
      void handleVerifyOTP().finally(() => { verifying.current = false; });
    }
    // handleVerifyOTP is re-created each render by design; the otp value is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp, step]);

  async function handlePinComplete(val: string) {
    if (val.length < 4) return;
    if (step === "pin") {
      setFirstPin(val);
      setConfirmPin("");
      setStep("confirm");
    } else {
      // Confirm step
      if (val !== firstPin) {
        setError(t("auth.pinMismatch"));
        setShake(true);
        setTimeout(() => { setShake(false); setError(""); setStep("pin"); setFirstPin(""); setConfirmPin(""); }, 600);
        return;
      }
      // Save new PIN
      const activeUser = routeUser || useAuthStore.getState().user;
      if (activeUser) {
        const saved = await savePin(activeUser.id, val);
        if (!saved) {
          // Identity is already proven by the code, so retrying costs one tap — and nobody is
          // told a new PIN was set when the server never received it.
          setError(t("copy.storageError"));
          setShake(true);
          setTimeout(() => { setShake(false); setError(""); }, 600);
          setStep("pin");
          setFirstPin("");
          setConfirmPin("");
          return;
        }
      }
      setPendingFlow(null);
      const dest = activeUser?.role === "admin"
        ? "/admin/dashboard" : "/employee/dashboard";
      navigate(dest, { replace: true });
    }
  }

  function handlePinChange(val: string) {
    if (step === "pin") setFirstPin(val);
    else setConfirmPin(val);
    if (val.length === 4) handlePinComplete(val);
  }

  const currentPin = step === "pin" ? firstPin : confirmPin;

  return (
    <AuthLayout>
      <NavHeader title={t("auth.resetPin")} backTo="/login" />
      {/* `.ds-auth-screen` sizes the code row and the keypad from the height the screen has
          (see the stylesheet), so all four steps of this flow fit one screen. */}
      <div
        className="ds-auth-screen flex flex-col flex-1 items-center px-6"
        style={{ gap: "var(--auth-rhythm, 24px)", paddingBlock: "var(--auth-pad, 24px)" }}
      >

        {/* Step 1: Enter phone (only if no user in state) */}
        {step === "phone" && (
          <>
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-xl font-bold text-foreground">{t("auth.resetPin")}</p>
              <p className="text-sm text-caption">{t("auth.verifyIdentity")}</p>
            </div>
            <div className="w-full flex flex-col gap-4">
              <Input
                label={t("common.phoneNumber")}
                type="tel"
                placeholder={t("common.phonePlaceholder")}
                value={phone}
                // Digits only, like the other phone fields.
                onChange={(e) => { setPhone(e.target.value.replace(/\D/g, "")); setError(""); }}
                error={error}
              />
              <Button fullWidth onClick={handleSendOTP} loading={loading} disabled={!phone}>
                {t("auth.sendVerificationCode")}
              </Button>
            </div>
          </>
        )}

        {/* Step 2: Verify OTP */}
        {step === "otp" && (
          <>
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-xl font-bold text-foreground">{t("auth.verifyNumber")}</p>
              <p className="text-sm text-caption">{t("auth.otpSentToNumber", { phone })}</p>
            </div>
            <OTPInput value={otp} onChange={(v) => { setOtp(v); setError(""); }} error={!!error} />
            {error && <p className="text-sm text-[#ef4444] text-center">{error}</p>}
            {/* No Verify button: the sixth digit is the submit, exactly as on the sign-in code
                screen. One tap fewer, and no state where a complete code is sitting there
                waiting for a second confirmation. The spinner is all that is left to show. */}
            {loading && (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-border-control border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-caption">{t("auth.verifying")}</p>
              </div>
            )}
          </>
        )}

        {/* Step 3: Set new PIN */}
        {(step === "pin" || step === "confirm") && (
          <>
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-xl font-bold text-foreground">
                {step === "pin" ? t("auth.setNewPin") : t("auth.confirmPin")}
              </p>
              <p className="text-sm text-caption">
                {step === "pin"
                  ? t("auth.pinSetHintLogin")
                  : t("auth.pinReenterHint")}
              </p>
              {error && <p className="text-sm text-[#ef4444]">{error}</p>}
            </div>
            <PINInput value={currentPin} onChange={handlePinChange} error={!!error} shake={shake} />
          </>
        )}
      </div>
    </AuthLayout>
  );
}
