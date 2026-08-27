import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthLayout from "@/components/layout/AuthLayout";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import OTPInput from "@/components/ui/OTPInput";
import PINInput from "@/components/ui/PINInput";
import { sendOTP, verifyOTPAndResolveUser } from "@/lib/auth";
import { savePin } from "@/lib/pinLock";
import { useAuthStore } from "@/stores/authStore";

type Step = "phone" | "otp" | "pin" | "confirm";

export default function ForgotPINPage() {
  const navigate = useNavigate();
  const { user, setUser, pendingPhone, setPendingPhone, setPendingFlow } = useAuthStore();

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState(pendingPhone || "");
  const [otp, setOtp] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  async function handleSendOTP() {
    if (!phone.trim()) { setError("Enter your phone number"); return; }
    setLoading(true);
    setError("");
    try {
      setPendingPhone(phone.trim());
      await sendOTP(phone.trim());
      setStep("otp");
    } catch {
      setError("Could not send code");
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
      if (result.status === "wrong_otp") { setError("Incorrect code. Try again."); setOtp(""); return; }
      if (result.status === "not_registered") { setError("Number not registered"); return; }
      if (result.status === "deactivated") { setError("Account deactivated"); return; }
      if (result.status === "error") { setError(result.message); return; }
      // OTP correct — now set new PIN
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
        setError("PINs don't match. Try again.");
        setShake(true);
        setTimeout(() => { setShake(false); setError(""); setStep("pin"); setFirstPin(""); }, 600);
        return;
      }
      // Save new PIN
      if (user) {
        await savePin(user.id, val);
        setUser({ ...user, pin: val });
      }
      setPendingFlow(null);
      const dest = user?.role === "admin" || user?.role === "co_admin"
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
      <NavHeader title="Reset PIN" backTo="/login" />
      <div className="flex flex-col flex-1 items-center gap-8 p-6 pt-8">

        {/* Step 1: Enter phone */}
        {step === "phone" && (
          <>
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-xl font-bold text-black">Reset your PIN</p>
              <p className="text-sm text-[#888]">Enter your phone number to verify your identity</p>
            </div>
            <div className="w-full flex flex-col gap-4">
              <Input
                label="Phone Number"
                type="tel"
                placeholder="e.g. 03001234567"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setError(""); }}
                error={error}
              />
              <Button fullWidth onClick={handleSendOTP} loading={loading} disabled={!phone}>
                Send Verification Code
              </Button>
            </div>
          </>
        )}

        {/* Step 2: Verify OTP */}
        {step === "otp" && (
          <>
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-xl font-bold text-black">Verify your number</p>
              <p className="text-sm text-[#888]">Enter the 6-digit code sent to <span className="font-medium text-black">{phone}</span></p>
            </div>
            <OTPInput value={otp} onChange={(v) => { setOtp(v); setError(""); }} error={!!error} />
            {error && <p className="text-sm text-[#ef4444] text-center">{error}</p>}
            {loading && (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-[#888]">Verifying...</p>
              </div>
            )}
            <Button fullWidth onClick={handleVerifyOTP} loading={loading} disabled={otp.length < 6}>
              Verify
            </Button>
          </>
        )}

        {/* Step 3: Set new PIN */}
        {(step === "pin" || step === "confirm") && (
          <>
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-xl font-bold text-black">
                {step === "pin" ? "Set a new 4-digit PIN" : "Confirm your PIN"}
              </p>
              <p className="text-sm text-[#888]">
                {step === "pin"
                  ? "You'll use this PIN to sign in on this device"
                  : "Re-enter your PIN to confirm"}
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
