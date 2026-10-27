import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import AuthLayout from "@/components/layout/AuthLayout";
import NavHeader from "@/components/ui/NavHeader";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { useT } from "@/lib/i18n";
import { isValidPhone, localPhone } from "@/lib/phoneInput";
import { requestEmployeeAccess } from "@/lib/employeeAccessRequests";

/**
 * The reverse of an invitation: the employee asks the owner to add them.
 *
 * The shop code is still the way in. This page only sends a note; it cannot
 * create a membership, and it deliberately does not tell the browser which shop
 * the owner number belongs to. The owner sees the request in the app, adds the
 * person through the existing flow, and then the employee signs in with the
 * code (or an invitation link).
 */
export default function RequestAccessPage() {
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState(() => localPhone(params.get("phone") ?? ""));
  const [ownerPhone, setOwnerPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSend() {
    setError("");
    if (!name.trim()) {
      setError(t("accessRequest.errName"));
      return;
    }
    if (!isValidPhone(phone)) {
      setError(t("accessRequest.errPhone"));
      return;
    }
    if (!isValidPhone(ownerPhone)) {
      setError(t("accessRequest.errOwnerPhone"));
      return;
    }
    setLoading(true);
    try {
      const result = await requestEmployeeAccess({
        ownerPhone,
        requesterName: name,
        requesterPhone: phone,
      });
      if (result.ok) {
        setSent(true);
        return;
      }
      if (result.reason === "owner_not_found") setError(t("accessRequest.ownerNotFound"));
      else if (result.reason === "rate_limited") setError(t("accessRequest.rateLimited"));
      else if (result.reason === "same_phone") setError(t("accessRequest.samePhone"));
      else setError(t("accessRequest.failed"));
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <AuthLayout>
        <NavHeader title={t("accessRequest.title")} backTo="/login" />
        <div
          className="flex flex-col flex-1 justify-between"
          data-testid="access-request-sent"
        >
          <div className="flex flex-col items-center text-center gap-3 px-6 pt-12">
            <CheckCircle2 size={44} style={{ color: "var(--brand)" }} />
            <p className="text-22 font-bold" style={{ color: "var(--text-primary)" }}>
              {t("accessRequest.sentTitle")}
            </p>
            <p className="text-14" style={{ color: "var(--text-secondary)" }}>
              {t("accessRequest.sentBody")}
            </p>
            <p className="text-12" style={{ color: "var(--text-secondary)" }}>
              {t("accessRequest.sentHint")}
            </p>
          </div>
          <div className="p-6">
            <Button fullWidth size="lg" onClick={() => navigate("/login")} testId="access-request-back">
              {t("accessRequest.backToSignIn")}
            </Button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <NavHeader title={t("accessRequest.title")} backTo="/login" />
      <div className="flex flex-col flex-1 justify-between">
        <div className="flex flex-col gap-5 p-6">
          <div className="flex flex-col gap-2">
            <p className="text-22 font-bold" style={{ color: "var(--text-primary)" }}>
              {t("accessRequest.heading")}
            </p>
            <p className="text-14" style={{ color: "var(--text-secondary)" }}>
              {t("accessRequest.body")}
            </p>
          </div>

          <Input
            label={t("accessRequest.name")}
            placeholder={t("accessRequest.namePlaceholder")}
            value={name}
            onChange={(e) => { setName(e.target.value); setError(""); }}
            data-testid="access-request-name"
          />
          <Input
            label={t("accessRequest.phone")}
            type="tel"
            placeholder={t("common.phonePlaceholder")}
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setError(""); }}
            hint={t("accessRequest.phoneHint")}
            autoComplete="tel"
            data-testid="access-request-phone"
          />
          <Input
            label={t("accessRequest.ownerPhone")}
            type="tel"
            placeholder={t("common.phonePlaceholder")}
            value={ownerPhone}
            onChange={(e) => { setOwnerPhone(e.target.value); setError(""); }}
            hint={t("accessRequest.ownerPhoneHint")}
            autoComplete="tel"
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            error={error || undefined}
            data-testid="access-request-owner-phone"
          />
        </div>

        <div className="flex flex-col gap-3 p-6">
          <Button
            fullWidth
            size="lg"
            onClick={handleSend}
            loading={loading}
            disabled={!name.trim() || !phone || !ownerPhone}
            testId="access-request-send"
          >
            {t("accessRequest.send")}
          </Button>
          <p className="text-11 text-center" style={{ color: "var(--text-secondary)" }}>
            {t("accessRequest.privacy")}
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
