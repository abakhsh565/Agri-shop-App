import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import AuthLayout from "@/components/layout/AuthLayout";
import NavHeader from "@/components/ui/NavHeader";
import PINInput from "@/components/ui/PINInput";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { verifyPin, clearPin } from "@/lib/pinLock";
import { normalizePhone } from "@/lib/auth";
import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/lib/supabase";

type Step = "phone" | "pin";

interface FoundUser {
  id: string;
  name: string;
  role: string;
  phone: string;
  photo_url?: string | null;
}

export default function PINLoginPage() {
  const navigate = useNavigate();
  const { setUser, setPendingPhone } = useAuthStore();

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [foundUser, setFoundUser] = useState<FoundUser | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);

  async function handleLookup() {
    if (!phone.trim()) { setError("Enter your phone number"); return; }
    setLoading(true);
    setError("");
    try {
      const e164 = normalizePhone(phone.trim());
      const { data, error: dbErr } = await supabase
        .from("users")
        .select("id, name, role, phone, photo_url")
        .eq("phone", e164)
        .maybeSingle();

      if (dbErr) { setError("Lookup failed: " + dbErr.message); return; }
      if (!data) { setError("Number not registered"); return; }

      const user = data as FoundUser;

      // Check if this user has a PIN on this device
      // We need to check before showing PIN pad
      // hasPin checks localStorage — we'll verify on submit instead
      setFoundUser(user);
      setPendingPhone(phone.trim());
      setStep("pin");
    } finally {
      setLoading(false);
    }
  }

  async function handlePinComplete(val: string) {
    if (val.length < 4 || verifying || !foundUser) return;
    setVerifying(true);
    try {
      const ok = await verifyPin(foundUser.id, val);
      if (ok) {
        // PIN correct — set user and go to dashboard
        setUser({
          id: foundUser.id,
          name: foundUser.name,
          phone: foundUser.phone,
          role: foundUser.role as "admin" | "employee" | "co_admin",
          isOriginalOwner: false,
          pin: "",
          isActive: true,
          photoUrl: foundUser.photo_url ?? undefined,
          firstLoginAt: null,
          lastLoginAt: null,
          deactivatedAt: null,
          deactivatedBy: null,
          createdAt: new Date().toISOString(),
          createdBy: null,
        });
        const dest = foundUser.role === "admin" || foundUser.role === "co_admin"
          ? "/admin/dashboard" : "/employee/dashboard";
        navigate(dest, { replace: true });
      } else {
        // PIN not set on this device or wrong — auto-fallback to OTP
        clearPin(foundUser.id);
        setPendingPhone(phone.trim());
        navigate("/login/otp", { replace: true });
      }
    } finally {
      setVerifying(false);
    }
  }

  function handleChange(val: string) {
    setPin(val);
    setError("");
    if (val.length === 4) handlePinComplete(val);
  }

  function handleForgotPIN() {
    if (foundUser) {
      setPendingPhone(phone.trim());
    }
    navigate("/login/forgot-pin");
  }

  return (
    <AuthLayout>
      <NavHeader title="Sign In" backTo="/login" />
      <div className="flex flex-col flex-1 items-center gap-8 p-6 pt-8">

        {/* Step 1: Enter phone number */}
        {step === "phone" && (
          <>
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-xl font-bold text-black">Welcome back</p>
              <p className="text-sm text-[#888]">Enter your phone number to continue</p>
            </div>
            <div className="w-full flex flex-col gap-4">
              <Input
                label="Phone Number"
                type="tel"
                placeholder="e.g. 03001234567"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setError(""); }}
                error={error}
                onKeyDown={(e) => e.key === "Enter" && handleLookup()}
              />
              <Button fullWidth onClick={handleLookup} loading={loading} disabled={!phone}>
                Continue
              </Button>
            </div>
            <p className="text-xs text-center text-[#888]">
              New shop owner?{' '}
              <button onClick={() => navigate("/register")} className="text-black font-medium underline">
                Register your shop
              </button>
            </p>
          </>
        )}

        {/* Step 2: Enter PIN */}
        {step === "pin" && foundUser && (
          <>
            <div className="flex flex-col items-center gap-2 text-center">
              {foundUser.photo_url ? (
                <img src={foundUser.photo_url} alt="" className="w-16 h-16 rounded-full object-cover mb-2" />
              ) : (
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold mb-2"
                  style={{ background: "var(--brand)", color: "#0a0a0a" }}
                >
                  {foundUser.name.charAt(0).toUpperCase()}
                </div>
              )}
              <p className="text-xl font-bold text-black">
                Welcome, {foundUser.name.split(" ")[0]}
              </p>
              <p className="text-sm text-[#888]">Enter your 4-digit PIN</p>
              {error && (
                <p className="text-sm text-[#ef4444]">{error}</p>
              )}
            </div>

            <PINInput value={pin} onChange={handleChange} error={!!error} shake={shake} />

            {verifying && (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-[#888]">Verifying...</p>
              </div>
            )}

            <button onClick={handleForgotPIN} className="text-sm font-medium text-[#888] underline underline-offset-2">
              Forgot PIN?
            </button>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
