import { useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ImageUpload from "@/components/ui/ImageUpload";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";

export default function AddCompanyPage() {
  const navigate = useNavigate();
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

  async function handleSave() {
    setError("");
    if (!name.trim()) { setError("Enter the company / supplier name."); return; }
    if (companies.some((c) => c.name.toLowerCase() === name.trim().toLowerCase())) {
      setError("A company with this name already exists.");
      return;
    }

    setLoading(true);
    try {
      await createCompany({
        name: name.trim(),
        contactPerson: contactPerson.trim() || undefined,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        logoUrl: logoUrl ?? undefined,
      });

      addToast(`${name.trim()} added`, "success");
      navigate("/admin/companies", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add company. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const fieldStyle = {
    background: "var(--surface-2)",
    border: "1px solid var(--divider)",
    color: "var(--text-primary)",
  } as const;
  const labelCls = "text-[11px] font-bold uppercase mb-2 tracking-wider";

  return (
    <div
      className="flex flex-col w-full min-h-full justify-between"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <div>
        <StatusBar />
        <NavHeader title="Add Company / Supplier" backTo="/admin/companies" />

        <div className="flex flex-col gap-5 p-4">
          <div className="flex justify-center pt-1">
            <ImageUpload bucket="company-logos" value={logoUrl} onChange={setLogoUrl} shape="circle" label="Add logo" />
          </div>

          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>Company Name</p>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Syngenta"
              className="w-full h-12 rounded-[24px] px-4 text-sm outline-none"
              style={{ ...fieldStyle, borderColor: error ? "var(--error)" : "var(--divider)" }} />
          </div>
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>Contact Person <span style={{ opacity: 0.6 }}>(optional)</span></p>
            <input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} placeholder="e.g. Imran Khan"
              className="w-full h-12 rounded-[24px] px-4 text-sm outline-none" style={fieldStyle} />
          </div>
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>Phone <span style={{ opacity: 0.6 }}>(optional)</span></p>
            <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03001234567"
              className="w-full h-12 rounded-[24px] px-4 text-sm outline-none" style={fieldStyle} />
          </div>
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>Address <span style={{ opacity: 0.6 }}>(optional)</span></p>
            <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} placeholder="Street, city"
              className="w-full rounded-xl p-3 text-sm outline-none resize-none" style={fieldStyle} />
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
          {loading ? "Saving…" : "Add Company"}
        </button>
      </div>
    </div>
  );
}
