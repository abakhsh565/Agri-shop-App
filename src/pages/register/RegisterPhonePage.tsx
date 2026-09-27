import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthLayout from "@/components/layout/AuthLayout";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { sendOTP, normalizePhone, checkPhoneRegistration } from "@/lib/auth";
import { useAuthStore } from "@/stores/authStore";
import { useShopRequestsStore } from "@/stores/shopRequestsStore";
import { useT } from "@/lib/i18n";

export default function RegisterPhonePage() {
  const t = useT();
  const navigate = useNavigate();
  const { setPendingPhone, setPendingFlow, setIsNewDevice } = useAuthStore();
  const { loadMyRequest } = useShopRequestsStore();

  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [phoneError, setPhoneError] = useState("");

  // Same accepted formats as sign-in: a number that can be typed on the login screen
  // must not be rejected on the signup screen.
  function validatePhone(p: string) {
    const clean = p.replace(/\s/g, "");
    return /^0\d{9,10}$/.test(clean) || /^92\d{10,11}$/.test(clean);
  }

  async function handleSendOTP() {
    setPhoneError("");
    const cleanPhone = phone.replace(/\s/g, "");

    if (!validatePhone(cleanPhone)) {
      setPhoneError(t("auth.errPhoneFormat"));
      return;
    }

    setLoading(true);
    try {
      const normalized = normalizePhone(cleanPhone);

      // Signup is for numbers nobody has yet. A registered number is refused here —
      // employees in particular get their access from their owner, never by signing
      // themselves up — and an application already on file goes to its status page
      // instead of being filed twice.
      const check = await checkPhoneRegistration(cleanPhone);
      if (check.status === "error") { setPhoneError(t("auth.checkFailed")); return; }
      if (check.status === "registered") {
        setPhoneError(t(check.role === "employee" ? "auth.employeeNumberTaken" : "auth.phoneTaken"));
        return;
      }
      if (check.status === "inactive") { setPhoneError(t("copy.accountDeactivated")); return; }
      if (check.status === "pending" || check.status === "rejected") {
        setPendingPhone(cleanPhone);
        navigate("/register/status", { replace: true });
        return;
      }

      await loadMyRequest(normalized);

      // Send OTP
      setPendingPhone(cleanPhone);
      setPendingFlow("register");
      setIsNewDevice(true);

      const result = await sendOTP(cleanPhone);
      if (!result.success) {
        setPhoneError(result.error || t("auth.errSendCode"));
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
            <p className="text-28 font-bold text-foreground">{t("register.yourShop")}</p>
            <p className="text-sm text-caption">
              {t("register.phoneIntro")}
            </p>
          </div>
          <div className="flex flex-col gap-4">
            <Input
              label={t("common.phoneNumber")}
              type="tel"
              placeholder={t("common.phonePlaceholder")}
              value={phone}
              /* Digits only — same rule as the sign-in field: the number is what is asked for,
                 so a letter never lands in the field. */
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              error={phoneError}
              autoComplete="tel"
              onKeyDown={(e) => e.key === "Enter" && handleSendOTP()}
            />
            <p className="text-xs text-caption">
              {t("register.phoneHint")}
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
            {t("auth.sendVerificationCode")}
          </Button>
          <p className="text-xs text-center text-caption">
            Already have an account?{" "}
            <button onClick={() => navigate("/login")} className="text-foreground font-medium underline">
              {t("auth.signIn")}
            </button>
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
