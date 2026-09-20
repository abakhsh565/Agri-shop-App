import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import AuthLayout from "@/components/layout/AuthLayout";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { sendOTP } from "@/lib/auth";
import { isDemoOtpMode } from "@/lib/authMode";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/lib/i18n";

export default function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const { setPendingPhone, setPendingFlow, setIsNewDevice } = useAuthStore();

  // An invitation link carries the employee's number, so they do not have to
  // type it: /login?phone=923001234567 (see lib/appInvite.ts).
  const [searchParams] = useSearchParams();
  const invitedPhone = (searchParams.get("phone") ?? "").replace(/\s/g, "");
  const [phone, setPhone] = useState(invitedPhone);
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
            <p className="text-[26px] font-bold" style={{ color: "var(--text-primary)" }}>{t("auth.welcomeBack")}</p>
            <p className="text-[14px]" style={{ color: "var(--text-secondary)" }}>{t("auth.enterPhone")}</p>
          </div>
          <div className="flex flex-col gap-4">
            {invitedPhone && (
              <div
                className="rounded-xl px-3 py-2"
                style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
                data-testid="invited-hint"
              >
                <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                  {t("auth.invitedHint")}
                </p>
              </div>
            )}
            <Input
              label={t("auth.phoneNumber")}
              type="tel"
              placeholder={t("common.phonePlaceholder")}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              error={phoneError}
              autoComplete="tel"
              onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
            />
            <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
              {isDemoOtpMode ? t("auth.codeHintDemo") : t("auth.codeHint")}
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
            {t("auth.sendCode")}
          </Button>
          <p className="text-xs text-center text-[#888]">
            {t("auth.newShopOwner")}{' '}
            <button onClick={() => navigate("/register")} className="text-black font-medium underline">
              {t("auth.registerShop")}
            </button>
          </p>

        </div>
      </div>
    </AuthLayout>
  );
}
