import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthLayout from "@/components/layout/AuthLayout";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { sendOTP } from "@/lib/auth";
import { useAuthStore } from "@/stores/authStore";

export default function LoginPage() {
  const navigate = useNavigate();
  const { setPendingPhone, setPendingFlow, setIsNewDevice } = useAuthStore();

  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [phoneError, setPhoneError] = useState("");

  function validatePhone(p: string) {
    const clean = p.replace(/\s/g, "");
    // Accept local format (03001234567) or international (923001234567)
    return /^0\d{9,10}$/.test(clean) || /^92\d{10,11}$/.test(clean);
  }

  async function handleSignIn() {
    setPhoneError("");
    const cleanPhone = phone.replace(/\s/g, "");

    if (!validatePhone(cleanPhone)) {
      setPhoneError("Enter a valid phone number (e.g. 03001234567 or 923001234567)");
      return;
    }

    setLoading(true);
    try {
      setPendingPhone(cleanPhone);
      setPendingFlow("login");
      setIsNewDevice(true);
      const result = await sendOTP(cleanPhone);
      if (!result.success) {
        setPhoneError(result.error || "Could not send the code. Check the number and try again.");
        return;
      }
      navigate("/login/otp");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <div className="flex flex-col flex-1 justify-between">
        <div className="flex flex-col gap-8 p-6">
          <div className="flex flex-col gap-2">
            <p className="text-[28px] font-bold text-black">Welcome back</p>
            <p className="text-sm text-[#888]">Enter your phone number to sign in</p>
          </div>
          <div className="flex flex-col gap-4">
            <Input
              label="Phone Number"
              type="tel"
              placeholder="e.g. 03001234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              error={phoneError}
              autoComplete="tel"
              onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
            />
            <p className="text-xs text-[#888]">
              We'll text you a 6-digit verification code.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4 p-6">
          <Button
            fullWidth
            size="lg"
            onClick={handleSignIn}
            loading={loading}
            disabled={!phone}
          >
            Send Code
          </Button>
          <p className="text-xs text-center text-[#888]">
            New shop owner?{' '}
            <button onClick={() => navigate("/register")} className="text-black font-medium underline">
              Register your shop
            </button>
          </p>

        </div>
      </div>
    </AuthLayout>
  );
}
