import { useState, useEffect } from "react";
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
      const dest = activeUser?.role === "admin" || activeUser?.role === "co_admin"
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
      <div className="flex flex-col flex-1 items-center gap-8 p-6 pt-8">

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
            {loading && (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-border-control border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-caption">{t("auth.verifying")}</p>
              </div>
            )}
            <Button fullWidth onClick={handleVerifyOTP} loading={loading} disabled={otp.length < 6}>
              {t("auth.verify")}
            </Button>
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
