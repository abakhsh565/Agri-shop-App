import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import OTPInput from "@/components/ui/OTPInput";
import { useT } from "@/lib/i18n";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { sendOTP, verifyConfirmOTP } from "@/lib/auth";
import { formatPhoneDisplay } from "@/lib/formatters";
import { digitsOnlyPhone, isValidPhone, localPhone } from "@/lib/phoneInput";
import {
  updateBusinessProfile,
  type BusinessPatch,
  type BusinessProfileShop,
} from "@/lib/businessProfile";

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const TYPE_VALUES = ["retail", "wholesale", "both"] as const;

/** The five facts on the page the owner may change. The shop id and the phone are not among them. */
export type BusinessField = "name" | "whatsapp" | "email" | "type" | "registration";

/**
 * One fact, edited on its own.
 *
 * WHY ONE AT A TIME. The page shows each line with its own Add/Change, because that is what an
 * owner is actually holding when they notice something wrong: one line. A sheet per line arrives
 * already filled with that line's value, says what it will do, and cannot quietly blank a field the
 * owner never looked at — the failure mode of a form that saves everything at once.
 *
 * A CODE FOR THE THREE THAT SAY WHO THE BUSINESS IS. Name, WhatsApp and email are how this business
 * is named and reached; a phone left on a counter should not be able to redirect a shop's calls.
 * Those three ask for a code sent to the number the ACCOUNT signs in with, before anything is
 * written. Shop type and registration number are descriptive — they save straight away.
 *
 * THE PHONE IS NOT HERE. That number is the account's sign-in identity, shown on the page with its
 * verified badge; changing a login number is an account operation with its own flow.
 */
export default function BusinessProfileSheet({
  shop,
  field,
  onClose,
  onSaved,
}: {
  shop: BusinessProfileShop | null;
  field: BusinessField;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const { addToast } = useUIStore();
  const accountPhone = useAuthStore((s) => s.user?.phone ?? null);

  const [value, setValue] = useState(() => {
    switch (field) {
      case "name": return shop?.name ?? "";
      case "whatsapp": return localPhone(shop?.whatsapp_phone ?? "");
      case "email": return shop?.email ?? "";
      case "type": return shop?.shop_type ?? "";
      case "registration": return shop?.registration_number ?? "";
    }
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step two: the validated patch waits here while the code is checked, so the value cannot move
  // under the person between sending and confirming.
  const [pending, setPending] = useState<BusinessPatch | null>(null);
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const busyRef = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const label = t(`business.field.${field}`);
  /** The three fields that identify the business or say how to reach it. */
  const needsCode = field === "name" || field === "whatsapp" || field === "email";

  /** What this sheet would write, or null with the reason on screen. */
  function readPatch(): BusinessPatch | null {
    if (field === "name") {
      const next = value.trim();
      if (!next) { setError(t("business.errName")); return null; }
      if (next === (shop?.name ?? "")) { setError(t("business.nothingChanged")); return null; }
      return { name: next };
    }

    if (field === "whatsapp") {
      const next = value.trim();
      if (next) {
        if (!isValidPhone(next)) { setError(t("business.errPhone")); return null; }
        if (next === localPhone(shop?.whatsapp_phone ?? "")) { setError(t("business.nothingChanged")); return null; }
        return { whatsapp: next };
      }
      if (!shop?.whatsapp_phone) { setError(t("business.nothingChanged")); return null; }
      return { whatsapp: "" };
    }

    if (field === "email") {
      const next = value.trim();
      if (next) {
        if (!EMAIL_SHAPE.test(next)) { setError(t("business.errEmail")); return null; }
        if (next === (shop?.email ?? "")) { setError(t("business.nothingChanged")); return null; }
        return { email: next };
      }
      if (!shop?.email) { setError(t("business.nothingChanged")); return null; }
      return { email: "" };
    }

    if (field === "type") {
      if (!value || value === (shop?.shop_type ?? "")) { setError(t("business.nothingChanged")); return null; }
      return { type: value };
    }

    const next = value.trim();
    if (next === (shop?.registration_number ?? "")) { setError(t("business.nothingChanged")); return null; }
    return { registration: next };
  }

  async function commit(patch: BusinessPatch) {
    setBusy(true);
    setError(null);
    try {
      await updateBusinessProfile(patch);
      addToast(t("business.saved"), "success");
      onSaved();
      onClose();
    } catch {
      setError(t("business.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    if (!accountPhone) { setError(t("business.errNoAccountPhone")); return; }
    setBusy(true);
    setError(null);
    const result = await sendOTP(accountPhone);
    setBusy(false);
    if (!result.success) { setError(t("business.verify.sendFailed")); return; }
    setCooldown(30);
  }

  async function onSave() {
    if (busyRef.current) return;
    setError(null);
    const patch = readPatch();
    if (!patch) return;

    if (!needsCode) {
      busyRef.current = true;
      await commit(patch);
      busyRef.current = false;
      return;
    }

    busyRef.current = true;
    setPending(patch);
    await sendCode();
    busyRef.current = false;
  }

  async function confirmWithCode() {
    if (busyRef.current || !pending || !accountPhone) return;
    if (code.replace(/\D/g, "").length !== 6) { setError(t("business.errCode")); return; }

    busyRef.current = true;
    setBusy(true);
    setError(null);
    const ok = await verifyConfirmOTP(accountPhone, code);
    if (!ok) {
      setBusy(false);
      busyRef.current = false;
      setError(t("business.verify.wrong"));
      return;
    }
    await commit(pending);
    busyRef.current = false;
  }

  const verifying = pending !== null;

  return (
    <Sheet open title={label} onClose={onClose} closeButton={!verifying}>
      <div className="px-5 flex flex-col gap-4" data-testid={`business-field-sheet-${field}`}>
        {!verifying ? (
          <>
            {field === "type" ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
                {TYPE_VALUES.map((option) => {
                  const active = value === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setValue(active ? "" : option)}
                      aria-pressed={active}
                      data-testid={`business-type-${option}`}
                      className="h-10 px-4 rounded-full text-13 font-semibold ds-pressable"
                      style={{
                        background: active ? "var(--brand)" : "var(--surface-2)",
                        color: active ? "#0a0a0a" : "var(--text-secondary)",
                        border: active ? "1px solid transparent" : "1px solid var(--divider)",
                      }}
                    >
                      {t(`business.type.${option}`)}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="ds-field">
                <input
                  className="h-full w-full flex-1 bg-transparent outline-none ds-body text-start"
                  // A phone number and an email address are left-to-right wherever the reader is:
                  // in Urdu the bare string is reordered by the bidi algorithm and reads as a
                  // different number or address.
                  dir={field === "whatsapp" || field === "email" ? "ltr" : undefined}
                  placeholder={
                    field === "email" ? "name@example.com" : field === "whatsapp" ? "03XX XXXXXXX" : undefined
                  }
                  value={value}
                  onChange={(e) =>
                    setValue(
                      field === "whatsapp"
                        ? digitsOnlyPhone(e.target.value)
                        : e.target.value,
                    )
                  }
                  // The shop's own name is not a "company" field a browser may autofill, and an
                  // autofilled value here would be saved as if the owner had typed it.
                  autoComplete="off"
                  type={field === "email" ? "email" : field === "whatsapp" ? "tel" : "text"}
                  inputMode={field === "whatsapp" ? "numeric" : field === "email" ? "email" : "text"}
                  maxLength={field === "email" ? 254 : field === "registration" ? 100 : 120}
                  aria-label={label}
                  data-testid={`business-input-${field}`}
                />
              </div>
            )}

            {error && (
              <p className="text-12" style={{ color: "var(--error)" }} role="alert">{error}</p>
            )}

            <button
              type="button"
              onClick={() => void onSave()}
              disabled={busy}
              data-testid="business-field-save"
              className="w-full h-12 rounded-full text-14 font-bold ds-pressable disabled:opacity-50"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              {busy ? t("common.saving") : t("common.save")}
            </button>

            {needsCode && (
              <p className="text-11 leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
                {t("business.verify.why")}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-13 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {formatPhoneDisplay(accountPhone)
                ? t("business.verify.body", { phone: formatPhoneDisplay(accountPhone) as string })
                : t("business.verify.bodyNoPhone")}
            </p>

            <OTPInput value={code} onChange={setCode} disabled={busy} error={Boolean(error)} />

            {error && (
              <p className="text-12" style={{ color: "var(--error)" }} role="alert">{error}</p>
            )}

            <button
              type="button"
              onClick={() => void confirmWithCode()}
              disabled={busy || code.length !== 6}
              data-testid="business-verify-confirm"
              className="w-full h-12 rounded-full text-14 font-bold ds-pressable disabled:opacity-50"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              {busy ? <Loader2 size={16} className="animate-spin mx-auto" /> : t("business.verify.confirm")}
            </button>

            <button
              type="button"
              onClick={() => { if (!busy && cooldown === 0) void sendCode(); }}
              disabled={busy || cooldown > 0}
              className="text-12 font-semibold ds-pressable disabled:opacity-50"
              style={{ color: "var(--text-secondary)" }}
            >
              {cooldown > 0
                ? t("business.verify.resendIn", { seconds: cooldown })
                : t("business.verify.resend")}
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
