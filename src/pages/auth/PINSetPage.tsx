import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import AuthLayout from "@/components/layout/AuthLayout";
import NavHeader from "@/components/ui/NavHeader";
import PINInput from "@/components/ui/PINInput";
import { savePin } from "@/lib/pinLock";
import { useAuthStore } from "@/stores/authStore";

export default function PINSetPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;
  const { user, setUser } = useAuthStore();
  const [step, setStep] = useState<"set" | "confirm">("set");
  const [firstPin, setFirstPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);

  async function handleSetComplete(pin: string) {
    if (pin.length < 4) return;
    if (step === "set") {
      setFirstPin(pin);
      setStep("confirm");
      setConfirmPin("");
    } else {
      if (pin !== firstPin) {
        setError(true);
        setShake(true);
        setTimeout(() => { setShake(false); setError(false); setStep("set"); setFirstPin(""); setConfirmPin(""); }, 600);
        return;
      }
      // The user is already resolved from Supabase during OTP verification.
      // The PIN is a device-only quick-unlock (hashed in localStorage) — it is
      // never sent to the server. See lib/pinLock.ts.
      if (user) {
        await savePin(user.id, pin);
        setUser({ ...user, pin });
      }
      // Navigate back to where the user came from, or to dashboard
      if (returnTo) {
        navigate(returnTo, { replace: true });
      } else {
        const dest = (user?.role === "admin" || user?.role === "co_admin") ? "/admin/dashboard" : "/employee/dashboard";
        navigate(dest, { replace: true });
      }
    }
  }

  const pin = step === "set" ? firstPin : confirmPin;
  const setter = step === "set" ? setFirstPin : setConfirmPin;

  function handleChange(val: string) {
    setter(val);
    if (val.length === 4) handleSetComplete(val);
  }

  return (
    <AuthLayout>
      <NavHeader title={step === "set" ? "Set PIN" : "Confirm PIN"} noBack />
      <div className="flex flex-col flex-1 items-center gap-8 p-6 pt-12">
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-xl font-bold text-black">
            {step === "set" ? "Set a 4-digit PIN" : "Confirm your PIN"}
          </p>
          <p className="text-sm text-[#888]">
            {step === "set"
              ? "You'll use this PIN to sign in quickly on this device"
              : "Re-enter your PIN to confirm"}
          </p>
          {error && <p className="text-sm text-[#ef4444]">PINs don't match. Try again.</p>}
        </div>
        <PINInput value={pin} onChange={handleChange} error={error} shake={shake} />
      </div>
    </AuthLayout>
  );
}
