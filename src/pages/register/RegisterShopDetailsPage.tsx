import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ImageUpload from "@/components/ui/ImageUpload";
import { useAuthStore } from "@/stores/authStore";
import { useShopRequestsStore } from "@/stores/shopRequestsStore";
import { useUIStore } from "@/stores/uiStore";
import { normalizePhone } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import BackButtonHandler from "@/components/ui/BackButtonHandler";
import ToastContainer from "@/components/ui/Toast";

const SHOP_TYPES = [
  { key: "retail", labelKey: "register.type.retail", hintKey: "register.type.retailHint" },
  { key: "wholesale", labelKey: "register.type.wholesale", hintKey: "register.type.wholesaleHint" },
  { key: "both", labelKey: "register.type.both", hintKey: "register.type.bothHint" },
];

export default function RegisterShopDetailsPage() {
  const t = useT();
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

  // This form is the step AFTER the code was verified, and the verified phone is the only
  // thing it has that a stranger cannot supply. Opening the URL directly used to render it
  // anyway, which let the code step be skipped entirely — the same door the signup OTP screen
  // already closes on its own (it sends an unverified visitor back to /register).
  useEffect(() => {
    if (!pendingPhone) navigate("/register", { replace: true });
  }, []);

  const fieldStyle = {
    background: "var(--surface-2)",
    border: "1px solid var(--divider)",
    color: "var(--text-primary)",
  } as const;

  async function handleSubmit() {
    setError("");
    if (!ownerName.trim()) {
      setError(t("register.errName"));
      return;
    }
    if (!shopName.trim()) {
      setError(t("register.errShopName"));
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
      addToast(t("register.submitted"), "success");
      navigate("/register/status", { replace: true });
    } else {
      setError(result.error || t("register.errSubmit"));
    }
  }

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />
      <NavHeader title={t("register.shopDetails")} backTo="/register" />

      <div className="flex flex-col gap-5 p-4 flex-1">
        {/* Logo */}
        <div className="flex justify-center pt-1">
          <ImageUpload
            bucket="company-logos"
            value={logoUrl}
            onChange={setLogoUrl}
            shape="square"
            label={t("register.shopLogo")}
          />
        </div>

        {/* Owner Name */}
        <div>
          <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
            {t("register.fullName")}
          </p>
          <input
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            placeholder={t("register.ownerNamePlaceholder")}
            className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
            style={fieldStyle}
          />
        </div>

        {/* Shop Name */}
        <div>
          <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
            {t("register.shopName")}
          </p>
          <input
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
            placeholder={t("register.shopNamePlaceholder")}
            className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
            style={fieldStyle}
          />
        </div>

        {/* Shop Type */}
        <div>
          <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
            {t("register.businessType")}
          </p>
          <div className="flex flex-col gap-2">
            {SHOP_TYPES.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setShopType(opt.key)}
                className="flex items-start gap-3 p-4 rounded-[var(--radius-card)] text-start transition-colors"
                style={{
                  background: "var(--surface)",
                  border: `1.5px solid ${shopType === opt.key ? "var(--brand)" : "var(--divider)"}`,
                }}
              >
                <div
                  className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5"
                  style={{ borderColor: shopType === opt.key ? "var(--brand)" : "var(--text-secondary)" }}
                >
                  {shopType === opt.key && <div className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--brand)" }} />}
                </div>
                <div>
                  <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{t(opt.labelKey)}</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{t(opt.hintKey)}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* City */}
        <div>
          <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
            {t("register.city")}
          </p>
          <input
            value={shopCity}
            onChange={(e) => setShopCity(e.target.value)}
            placeholder={t("register.cityPlaceholder")}
            className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
            style={fieldStyle}
          />
        </div>

        {/* Address */}
        <div>
          <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
            {t("register.shopAddress")}
          </p>
          <input
            value={shopAddress}
            onChange={(e) => setShopAddress(e.target.value)}
            placeholder={t("register.addressPlaceholder")}
            className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
            style={fieldStyle}
          />
        </div>

        {/* Business Registration */}
        <div>
          <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
            {t("register.businessReg")} <span style={{ opacity: 0.6 }}>{t("common.optional")}</span>
          </p>
          <input
            value={businessRegNumber}
            onChange={(e) => setBusinessRegNumber(e.target.value)}
            placeholder={t("register.taxNumberPlaceholder")}
            className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
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
          {loading ? t("common.submitting") : t("register.submit")}
        </button>
      </div>

      {/* This screen is not inside AuthLayout, and it is the one where an accidental back press
          costs the most: a half-filled shop form with a logo already uploaded. Back steps to
          the sign-up entry instead of closing the app, and the two-press notice has a host. */}
      <BackButtonHandler />
      <ToastContainer />
    </div>
  );
}
