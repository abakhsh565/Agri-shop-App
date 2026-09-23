import { useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ImageUpload from "@/components/ui/ImageUpload";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import { clearNav } from "@/lib/navContext";
import { readReturnTo, withCreatedId } from "@/lib/dependencyGraph";
import { useT } from "@/lib/i18n";

export default function AddCompanyPage() {
  const t = useT();
  const navigate = useNavigate();
  // A screen that hit this entity as a missing dependency sent us here with the
  // workflow to come back to. Without it, creating a supplier mid-task drops the user
  // in the supplier list and leaves them to find their way back.
  const returnTo = readReturnTo(useSearchParams()[0], "/admin/companies");
  const { addToast } = useUIStore();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";

  const companies = useCompaniesStore((s) => s.companies);
  const createCompany = useCompaniesStore((s) => s.createCompany);

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const savingRef = useRef(false);

  async function handleSave() {
    setError("");
    if (!name.trim()) { setError(t("copy.enterCompanyName")); return; }
    if (companies.some((c) => c.name.toLowerCase() === name.trim().toLowerCase())) {
      setError(t("copy.companyExists"));
      return;
    }

    // A ref, not `loading`: React batches, so two taps in one task both read the
    // pre-render `false` and the same supplier is created twice.
    if (savingRef.current) return;
    savingRef.current = true;
    setLoading(true);
    try {
      const created = await createCompany({
        name: name.trim(),
        contactPerson: contactPerson.trim() || undefined,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        logoUrl: logoUrl ?? undefined,
      });

      addToast(t("copy.added", { name: name.trim() }), "success");
      clearNav();
      // Hand the new supplier's id back to the caller, so the picker that was empty
      // comes up with it already chosen instead of asking for the same choice again.
      navigate(withCreatedId(returnTo, "/admin/companies", "companyId", created.id), { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.addCompanyFailed"));
    } finally {
      savingRef.current = false;
      setLoading(false);
    }
  }

  const fieldStyle = {
    background: "var(--surface-2)",
    border: "1px solid var(--divider)",
    color: "var(--text-primary)",
  } as const;
  const labelCls = "text-11 font-bold uppercase mb-2 tracking-wider";

  return (
    <div
      className="flex flex-col w-full min-h-full justify-between"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <div>
        <StatusBar />
        <NavHeader title={t("supplier.addCompany")} />

        <div className="flex flex-col gap-5 p-4">
          <div className="flex justify-center pt-1">
            <ImageUpload bucket="company-logos" value={logoUrl} onChange={setLogoUrl} shape="circle" label={t("company.addLogo")} />
          </div>

          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("company.name")}</p>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("company.namePlaceholder")}
              className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
              style={{ ...fieldStyle, borderColor: error ? "var(--error)" : "var(--divider)" }} />
          </div>
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("common.contactPerson")} <span style={{ opacity: 0.6 }}>{t("common.optional")}</span></p>
            <input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} placeholder={t("company.ownerPlaceholder")}
              className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none" style={fieldStyle} />
          </div>
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("common.phone")} <span style={{ opacity: 0.6 }}>{t("common.optional")}</span></p>
            <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03001234567"
              className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none" style={fieldStyle} />
          </div>
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("common.address")} <span style={{ opacity: 0.6 }}>{t("common.optional")}</span></p>
            <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} placeholder={t("company.streetCityPlaceholder")}
              className="w-full rounded-[var(--radius-tile)] p-3 text-sm outline-none resize-none" style={fieldStyle} />
          </div>

          {error && <p className="text-xs" style={{ color: "var(--error)" }}>{error}</p>}
        </div>
      </div>

      <div className="p-4 pb-6">
        <button
          onClick={handleSave}
          disabled={loading}
          className="w-full h-12 rounded-full font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
        >
          {loading ? t("common.saving") : t("admin.addCompany")}
        </button>
      </div>
    </div>
  );
}
