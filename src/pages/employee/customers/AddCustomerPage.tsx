import { useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ImageUpload from "@/components/ui/ImageUpload";
import ReminderConfigSheet from "@/components/ui/ReminderConfigSheet";
import { useCustomersStore } from "@/stores/customersStore";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useShellBase } from "@/lib/useShellBase";
import { clearNav } from "@/lib/navContext";
import type { ReminderConfig } from "@/types";
import { Bell } from "lucide-react";
import { KNOWN_CROPS } from "@/lib/recommendationEngine";
import { saveCustomerCrops } from "@/lib/reminderEngine";

function normalizePhone(p: string): string {
  return p.replace(/[\s\-()]/g, "").replace(/^\+?92/, "0");
}

function isValidPakistaniPhone(raw: string): boolean {
  // Accepts: 03001234567, 923001234567, +923001234567
  return /^(0\d{10}|92\d{10}|\+92\d{10})$/.test(raw);
}

export default function AddCustomerPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const { addToast } = useUIStore();
  const { user } = useAuthStore();
  const customers = useCustomersStore((s) => s.customers);
  const createCustomer = useCustomersStore((s) => s.createCustomer);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [existingCustomerId, setExistingCustomerId] = useState<string | null>(null);
  const [showReminderConfig, setShowReminderConfig] = useState(false);
  const [reminderConfig, setReminderConfig] = useState<ReminderConfig | null>(null);
  const [selectedCrops, setSelectedCrops] = useState<string[]>([]);

  async function handleSave() {
    const errs: Record<string, string> = {};
    setExistingCustomerId(null);

    if (!name.trim()) {
      errs.name = isUrdu ? "نام درج کریں" : "Name is required";
    }

    if (!phone.trim()) {
      errs.phone = isUrdu ? "فون نمبر درج کریں" : "Phone number is required";
    } else {
      const raw = normalizePhone(phone);
      if (!isValidPakistaniPhone(raw)) {
        errs.phone = isUrdu
          ? "درست فون نمبر درج کریں"
          : "Enter a valid phone number (e.g. 03001234567 or 923001234567)";
      } else {
        const existing = customers.find((c) => {
          const cp = normalizePhone(c.phone);
          return cp === raw && !c.isArchived;
        });
        if (existing) {
          errs.phone = isUrdu
            ? `"${existing.name}" کے ساتھ پہلے سے رجسٹرڈ ہے`
            : `Already registered with "${existing.name}"`;
          setExistingCustomerId(existing.id);
        }
      }
    }

    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }

    setLoading(true);
    try {
      const normalizedPhone = normalizePhone(phone);
      const newCustomer = await createCustomer({
        name: name.trim(),
        phone: normalizedPhone,
        address: address.trim() || undefined,
        creditLimit: creditLimit ? parseFloat(creditLimit) : 0,
        createdBy: user?.id,
      });
      // Persist image if uploaded
      if (imageUrl && newCustomer.id) {
        const { updateCustomerImage } = useCustomersStore.getState();
        await updateCustomerImage(newCustomer.id, imageUrl);
      }
      // Persist crop assignments
      if (selectedCrops.length > 0 && newCustomer.id) {
        await saveCustomerCrops(newCustomer.id, selectedCrops);
      }
      addToast(`${name} ${isUrdu ? "شامل کر دیا گیا" : "added successfully"}`, "success");
      clearNav();
      navigate(`${base}/customers`, { replace: true });
    } catch (e: any) {
      const msg = e?.message || e?.error?.message || (typeof e === 'string' ? e : String(e));
      setErrors({ phone: msg });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="flex flex-col w-full min-h-full justify-between"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <div>
        <StatusBar />
        <NavHeader title={t("addCustomer.title")} />

        <div className="flex flex-col gap-5 p-4 mt-2">
          {/* Profile Image */}
          <div className="flex justify-center">
            <ImageUpload
              bucket="customer-images"
              value={imageUrl}
              onChange={setImageUrl}
              shape="circle"
              label={t("common.addPhoto")}
            />
          </div>

          {/* Name */}
          <div>
            <p className="text-[11px] font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
              {t("addCustomer.name")}
            </p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isUrdu ? "گاہک کا پورا نام" : "Enter customer name"}
              className="w-full h-12 rounded-[24px] px-4 text-sm outline-none"
              style={{
                background: "var(--surface-2)",
                border: `1px solid ${errors.name ? "var(--error)" : "var(--divider)"}`,
                color: "var(--text-primary)",
              }}
            />
            {errors.name && <p className="text-xs mt-1" style={{ color: "var(--error)" }}>{errors.name}</p>}
          </div>

          {/* Phone */}
          <div>
            <p className="text-[11px] font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
              {t("addCustomer.phone")}
            </p>
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="03001234567"
              className="w-full h-12 rounded-[24px] px-4 text-sm outline-none"
              style={{
                background: "var(--surface-2)",
                border: `1px solid ${errors.phone ? "var(--error)" : "var(--divider)"}`,
                color: "var(--text-primary)",
              }}
            />
            {errors.phone && (
              <div className="flex items-center gap-1 mt-1">
                <p className="text-xs" style={{ color: "var(--error)" }}>{errors.phone}</p>
                {existingCustomerId && (
                  <button
                    onClick={() => navigate(`${base}/customers/${existingCustomerId}`)}
                    className="text-xs font-bold underline"
                    style={{ color: "var(--brand-dark)" }}
                  >
                    {isUrdu ? "گاہک دیکھیں" : "View customer →"}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Address */}
          <div>
            <p className="text-[11px] font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
              {t("addCustomer.address")}
            </p>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={isUrdu ? "گاؤں / شہر / قصبہ" : "Village / town / city"}
              className="w-full h-12 rounded-[24px] px-4 text-sm outline-none"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--divider)",
                color: "var(--text-primary)",
              }}
            />
          </div>

          {/* Crops */}
          <div>
            <p className="text-[11px] font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
              {t("common.crops")}
            </p>
            <div className="flex flex-wrap gap-2">
              {KNOWN_CROPS.map(cropName => (
                <button
                  key={cropName}
                  type="button"
                  onClick={() => setSelectedCrops(prev => prev.includes(cropName) ? prev.filter(c => c !== cropName) : [...prev, cropName])}
                  className="h-9 px-4 rounded-full text-[12px] font-medium transition-colors"
                  style={{
                    background: selectedCrops.includes(cropName) ? "var(--brand)" : "var(--surface-2)",
                    color: selectedCrops.includes(cropName) ? "#0a0a0a" : "var(--text-secondary)",
                    border: selectedCrops.includes(cropName) ? "none" : "1px solid var(--divider)",
                  }}
                >
                  {cropName}
                </button>
              ))}
            </div>
            <p className="text-[11px] mt-1" style={{ color: "var(--text-secondary)" }}>
              {t("common.whatCrops")}
            </p>
          </div>

          {/* Credit Limit + Reminder Config */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                {t("customers.creditLimit")} {t("common.optional")}
              </p>
              <button
                type="button"
                onClick={() => setShowReminderConfig(true)}
                className="flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[10px] font-semibold"
                style={{ background: reminderConfig ? "var(--brand-light, #d9f99d)" : "var(--surface-2)", color: reminderConfig ? "var(--brand-dark, #65a30d)" : "var(--text-secondary)", border: "1px solid var(--divider)" }}
              >
                <Bell size={12} /> {t("customer.reminder")}
              </button>
            </div>
            <input
              type="number"
              inputMode="decimal"
              value={creditLimit}
              onChange={(e) => setCreditLimit(e.target.value)}
              placeholder="0"
              min="0"
              className="w-full h-12 rounded-[24px] px-4 text-sm outline-none"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--divider)",
                color: "var(--text-primary)",
              }}
            />
            <p className="text-[11px] mt-1" style={{ color: "var(--text-secondary)" }}>
              {isUrdu ? "اس گاہک کو کتنا ادھار دے سکتے ہیں" : "Maximum credit amount for this customer"}
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 pb-6">
        <button
          onClick={handleSave}
          disabled={loading}
          className="w-full h-12 rounded-full font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
        >
          {loading ? t("common.loading") : t("addCustomer.submit")}
        </button>
      </div>

      {/* Reminder Config Bottom Sheet */}
      {showReminderConfig && (
        <ReminderConfigSheet
          config={reminderConfig}
          onSave={(config) => {
            setReminderConfig(config);
            setShowReminderConfig(false);
          }}
          onClose={() => setShowReminderConfig(false)}
        />
      )}
    </div>
  );
}
