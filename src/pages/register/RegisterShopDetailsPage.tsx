import { useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ImageUpload from "@/components/ui/ImageUpload";
import { useAuthStore } from "@/stores/authStore";
import { useShopRequestsStore } from "@/stores/shopRequestsStore";
import { useUIStore } from "@/stores/uiStore";
import { normalizePhone } from "@/lib/auth";

const SHOP_TYPES = [
  { key: "retail", label: "Retail Shop", hint: "Sell directly to customers" },
  { key: "wholesale", label: "Wholesale", hint: "Sell in bulk to businesses" },
  { key: "both", label: "Both", hint: "Retail + Wholesale" },
];

export default function RegisterShopDetailsPage() {
  const navigate = useNavigate();
  const { pendingPhone } = useAuthStore();
  const { submitRequest, loading } = useShopRequestsStore();
  const { addToast } = useUIStore();

  const [ownerName, setOwnerName] = useState("");
  const [shopName, setShopName] = useState("");
  const [shopAddress, setShopAddress] = useState("");
  const [shopCity, setShopCity] = useState("");
  const [shopType, setShopType] = useState("retail");
  const [businessRegNumber, setBusinessRegNumber] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [error, setError] = useState("");

  const fieldStyle = {
    background: "var(--surface-2)",
    border: "1px solid var(--divider)",
    color: "var(--text-primary)",
  } as const;

  async function handleSubmit() {
    setError("");
    if (!ownerName.trim()) {
      setError("Enter your name");
      return;
    }
    if (!shopName.trim()) {
      setError("Enter your shop name");
      return;
    }

    const normalized = normalizePhone(pendingPhone);
    const result = await submitRequest({
      ownerName: ownerName.trim(),
      ownerPhone: normalized,
      shopName: shopName.trim(),
      shopAddress: shopAddress.trim() || undefined,
      shopCity: shopCity.trim() || undefined,
      shopType,
      businessRegistrationNumber: businessRegNumber.trim() || undefined,
      logoUrl: logoUrl ?? undefined,
    });

    if (result.success) {
      addToast("Registration submitted! We'll review your request soon.", "success");
      navigate("/register/status", { replace: true });
    } else {
      setError(result.error || "Failed to submit. Try again.");
    }
  }

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />
      <NavHeader title="Shop Details" backTo="/register" />

      <div className="flex flex-col gap-5 p-4 flex-1">
        {/* Logo */}
        <div className="flex justify-center pt-1">
          <ImageUpload
            bucket="company-logos"
            value={logoUrl}
            onChange={setLogoUrl}
            shape="square"
            label="Shop Logo"
          />
        </div>

        {/* Owner Name */}
        <div>
          <p className="text-[11px] font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
            Your Full Name
          </p>
          <input
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            placeholder="e.g. Muhammad Ali"
            className="w-full h-12 rounded-[24px] px-4 text-sm outline-none"
            style={fieldStyle}
          />
        </div>

        {/* Shop Name */}
        <div>
          <p className="text-[11px] font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
            Shop / Business Name
          </p>
          <input
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
            placeholder="e.g. Khan Agricultural Store"
            className="w-full h-12 rounded-[24px] px-4 text-sm outline-none"
            style={fieldStyle}
          />
        </div>

        {/* Shop Type */}
        <div>
          <p className="text-[11px] font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
            Business Type
          </p>
          <div className="flex flex-col gap-2">
            {SHOP_TYPES.map((t) => (
              <button
                key={t.key}
                onClick={() => setShopType(t.key)}
                className="flex items-start gap-3 p-4 rounded-[14px] text-left transition-colors"
                style={{
                  background: "var(--surface)",
                  border: `1.5px solid ${shopType === t.key ? "var(--brand)" : "var(--divider)"}`,
                }}
              >
                <div
                  className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5"
                  style={{ borderColor: shopType === t.key ? "var(--brand)" : "var(--text-secondary)" }}
                >
                  {shopType === t.key && <div className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--brand)" }} />}
                </div>
                <div>
                  <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{t.label}</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{t.hint}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* City */}
        <div>
          <p className="text-[11px] font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
            City
          </p>
          <input
            value={shopCity}
            onChange={(e) => setShopCity(e.target.value)}
            placeholder="e.g. Lahore"
            className="w-full h-12 rounded-[24px] px-4 text-sm outline-none"
            style={fieldStyle}
          />
        </div>

        {/* Address */}
        <div>
          <p className="text-[11px] font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
            Shop Address
          </p>
          <input
            value={shopAddress}
            onChange={(e) => setShopAddress(e.target.value)}
            placeholder="e.g. Main Market, Shop 12"
            className="w-full h-12 rounded-[24px] px-4 text-sm outline-none"
            style={fieldStyle}
          />
        </div>

        {/* Business Registration */}
        <div>
          <p className="text-[11px] font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
            Business Registration # <span style={{ opacity: 0.6 }}>(optional)</span>
          </p>
          <input
            value={businessRegNumber}
            onChange={(e) => setBusinessRegNumber(e.target.value)}
            placeholder="NTN or other registration number"
            className="w-full h-12 rounded-[24px] px-4 text-sm outline-none"
            style={fieldStyle}
          />
        </div>

        {error && <p className="text-xs" style={{ color: "var(--error)" }}>{error}</p>}
      </div>

      <div className="p-4 pb-6">
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full h-12 rounded-full font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
        >
          {loading ? "Submitting..." : "Submit Registration"}
        </button>
      </div>
    </div>
  );
}
