import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ImageUpload from "@/components/ui/ImageUpload";
import { readReturnTo, withCreatedId } from "@/lib/dependencyGraph";
import ReminderConfigSheet from "@/components/ui/ReminderConfigSheet";
import { useCustomersStore } from "@/stores/customersStore";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/lib/i18n";
import { digitsOnlyPhone, phoneFieldProps } from "@/lib/phoneInput";
import { useThemeStore } from "@/stores/themeStore";
import { useShellBase } from "@/lib/useShellBase";
import { clearNav } from "@/lib/navContext";
import LocationField from "@/components/ui/LocationField";
import type { PickedPlace } from "@/lib/geo";
import type { ReminderConfig } from "@/types";
import { Bell } from "lucide-react";
import { ContactRound } from "lucide-react";
import { KNOWN_CROPS } from "@/lib/recommendationEngine";
import { saveCustomerCrops, saveReminderConfig } from "@/lib/reminderEngine";
import { hasPermission } from "@/lib/tenantContext";
import { canPickContact, pickContact } from "@/lib/contacts";

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
  const returnTo = readReturnTo(useSearchParams()[0], `${base}/customers`);
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const { addToast } = useUIStore();
  const { user } = useAuthStore();
  const customers = useCustomersStore((s) => s.customers);
  const createCustomer = useCustomersStore((s) => s.createCustomer);
  const canSetCreditLimit = hasPermission("customers.credit_limit");

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  //
  // The customer's location, as a place rather than a line of text.
  //
  // This replaced a free-text address field. Two problems with the old one, and the second is why
  // the field is gone rather than sitting next to a map: an address somebody typed cannot be drawn
  // on a map or routed to, and an address that is typed AND pinned lets the two disagree — the pin
  // in one town, the words about another. What is stored now is a point the map service produced
  // plus the address that came with it.
  //
  const [place, setPlace] = useState<PickedPlace | null>(null);
  // A full address the person can type, separate from the map pin. The pin gives routing;
  // the line gives the gate number, street or landmark a courier actually needs.
  const [addressLine, setAddressLine] = useState("");
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
      errs.name = t("customerProfile.nameRequired");
    }

    if (!phone.trim()) {
      errs.phone = t("inline.phone_number_is_required");
    } else {
      const raw = normalizePhone(phone);
      if (!isValidPakistaniPhone(raw)) {
        errs.phone = t("inline.enter_a_valid_phone_number_e_g_03001234567_o");
      } else {
        const existing = customers.find((c) => {
          const cp = normalizePhone(c.phone);
          return cp === raw && !c.isArchived;
        });
        if (existing) {
          // The same sentence already exists for this case; a second wording here
          // would be one message said two ways on two screens.
          errs.phone = t("customerProfile.phoneAlreadyRegistered", { name: existing.name });
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
        address: addressLine.trim() || place?.address || undefined,
        creditLimit: canSetCreditLimit && creditLimit ? parseFloat(creditLimit) : 0,
        createdBy: user?.id,
        place,
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
      // Persist the reminder configuration chosen in this flow. It was collected by
      // the sheet and then dropped on the floor: the config was never written, so
      // Customer Details (which reads configs from the database) showed none.
      if (reminderConfig && newCustomer.id) {
        await saveReminderConfig(newCustomer.id, reminderConfig);
      }
      addToast(`${name} ${t("inline.added_successfully")}`, "success");
      clearNav();
      // A sale that needed a customer sent us here with the workflow to come back to;
      // the new id goes back with it so the sale continues with this customer chosen
      // instead of re-asking. Opened normally, this still lands on the customer list.
      navigate(
        newCustomer.id
          ? withCreatedId(returnTo, `${base}/customers`, "customerId", newCustomer.id)
          : `${base}/customers`,
        { replace: true },
      );
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
        <NavHeader title={t("addCustomer.title")} historyBack />

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
            <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
              {t("addCustomer.name")}
            </p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("inline.enter_customer_name")}
              className={`w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none ${
                errors.name ? "border-[#ef4444]" : ""
              }`}
              style={{ background: "var(--field-bg)", color: "var(--text-primary)" }}
            />
            {errors.name && <p className="text-xs mt-1" style={{ color: "var(--error)" }}>{errors.name}</p>}
          </div>

          {/* Phone */}
          <div>
            <div className="flex items-center justify-between gap-3 mb-2">
              <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
                {t("addCustomer.phone")}
              </p>
              <button
                type="button"
                onClick={async () => {
                  if (!canPickContact()) {
                    addToast(t("contacts.notSupported"), "info");
                    return;
                  }
                  try {
                    const contact = await pickContact();
                    if (!contact) return;
                    if (contact.name) setName(contact.name);
                    if (contact.phone) setPhone(digitsOnlyPhone(contact.phone));
                  } catch {
                    addToast(t("contacts.permissionDenied"), "error");
                  }
                }}
                data-testid="customer-contact-pick"
                className="flex items-center gap-1.5 h-7 px-2.5 rounded-full text-10 font-semibold active:opacity-70"
                style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--divider)" }}
              >
                <ContactRound size={12} /> {t("contacts.pick")}
              </button>
            </div>
            <input
              {...phoneFieldProps()}
              value={phone}
              onChange={(e) => setPhone(digitsOnlyPhone(e.target.value))}
              placeholder="03001234567"
              className={`w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none ${
                errors.phone ? "border-[#ef4444]" : ""
              }`}
              style={{ background: "var(--field-bg)", color: "var(--text-primary)" }}
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
                    {t("inline.view_customer")}
                  </button>
                )}
              </div>
            )}
          </div>

          {/*
            Location — picked, never typed.

            The label above the field is the app's own word for it rather than a second
            “Address (optional)”: there is exactly one way to say where this customer is, and the
            old label described the thing that was replaced.
          */}
          <LocationField
            value={place}
            onChange={setPlace}
            label={t("addCustomer.address")}
            hint={t("location.notTyped")}
            testId="customer-location"
          />

          {/* Optional, and never a replacement for the pin: the map is where the customer is,
              this is the line a person reads at the gate. */}
          <div>
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
                {t("addCustomer.fullAddress")}
              </p>
              <span className="text-11" style={{ color: "var(--text-tertiary)" }}>
                {t("common.optional")}
              </span>
            </div>
            <input
              value={addressLine}
              onChange={(e) => setAddressLine(e.target.value)}
              placeholder={t("addCustomer.fullAddressHint")}
              data-testid="customer-full-address"
              className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
              style={{ background: "var(--field-bg)", color: "var(--text-primary)" }}
            />
          </div>

          {/* Crops */}
          <div>
            <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
              {t("common.crops")}
            </p>
            <div className="flex flex-wrap gap-2">
              {KNOWN_CROPS.map(cropName => (
                <button
                  key={cropName}
                  type="button"
                  onClick={() => setSelectedCrops(prev => prev.includes(cropName) ? prev.filter(c => c !== cropName) : [...prev, cropName])}
                  className="h-9 px-4 rounded-full text-12 font-medium transition-colors"
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
            <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>
              {t("common.whatCrops")}
            </p>
          </div>

          {/* Credit Limit + Reminder Config. The limit is its own grant (0251); an employee
              without it sees no field and cannot smuggle a value through the create RPC. */}
          <div>
            <div className="flex items-center justify-between mb-2">
              {canSetCreditLimit ? (
                <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
                  {t("customers.creditLimit")} {t("common.optional")}
                </p>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => setShowReminderConfig(true)}
                className="flex items-center gap-1.5 h-7 px-2.5 rounded-full text-10 font-semibold"
                style={{ background: reminderConfig ? "var(--brand-light, #d9f99d)" : "var(--surface-2)", color: reminderConfig ? "var(--brand-dark, #65a30d)" : "var(--text-secondary)", border: "1px solid var(--divider)" }}
              >
                <Bell size={12} /> {t("customer.reminder")}
              </button>
            </div>
            {canSetCreditLimit && (
              <>
                <input
                  type="number"
                  inputMode="decimal"
                  value={creditLimit}
                  onChange={(e) => setCreditLimit(e.target.value)}
                  placeholder="0"
                  min="0"
                  data-testid="customer-credit-limit"
                  className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
                  style={{
                    background: "var(--field-bg)",
                    color: "var(--text-primary)",
                  }}
                />
                <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>
                  {t("inline.maximum_credit_amount_for_this_customer")}
                </p>
              </>
            )}
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
