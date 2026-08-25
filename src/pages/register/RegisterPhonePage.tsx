import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthLayout from "@/components/layout/AuthLayout";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { sendOTP, normalizePhone } from "@/lib/auth";
import { useAuthStore } from "@/stores/authStore";
import { useShopRequestsStore } from "@/stores/shopRequestsStore";

export default function RegisterPhonePage() {
  const navigate = useNavigate();
  const { setPendingPhone, setPendingFlow, setIsNewDevice } = useAuthStore();
  const { loadMyRequest } = useShopRequestsStore();

  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [phoneError, setPhoneError] = useState("");

  function validatePhone(p: string) {
    return /^0\d{9,10}$/.test(p.replace(/\s/g, ""));
  }

  async function handleSendOTP() {
    setPhoneError("");
    const cleanPhone = phone.replace(/\s/g, "");

    if (!validatePhone(cleanPhone)) {
      setPhoneError("Enter a valid phone number (e.g. 03001234567)");
      return;
    }

    setLoading(true);
    try {
      const normalized = normalizePhone(cleanPhone);

      // Check if this phone already has a request
      await loadMyRequest(normalized);

      // Send OTP
      setPendingPhone(cleanPhone);
      setPendingFlow("register");
      setIsNewDevice(true);

      const result = await sendOTP(cleanPhone);
      if (!result.success) {
        setPhoneError(result.error || "Could not send the code. Try again.");
        return;
      }

      navigate("/register/otp");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <div className="flex flex-col flex-1 justify-between">
        <div className="flex flex-col gap-8 p-6">
          <div className="flex flex-col gap-2">
            <p className="text-[28px] font-bold text-black">Register Your Shop</p>
            <p className="text-sm text-[#888]">
              Enter your phone number to get started. We'll send a verification code.
            </p>
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
              onKeyDown={(e) => e.key === "Enter" && handleSendOTP()}
            />
            <p className="text-xs text-[#888]">
              This will be your admin login number. Keep it safe.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4 p-6">
          <Button
            fullWidth
            size="lg"
            onClick={handleSendOTP}
            loading={loading}
            disabled={!phone}
          >
            Send Verification Code
          </Button>
          <p className="text-xs text-center text-[#888]">
            Already have an account?{" "}
            <button onClick={() => navigate("/login")} className="text-black font-medium underline">
              Sign in
            </button>
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
