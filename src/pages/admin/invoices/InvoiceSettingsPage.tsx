import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Eye, Loader2 } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import Switch from "@/components/ui/Switch";
import Sheet from "@/components/ui/Sheet";
import ImageUpload from "@/components/ui/ImageUpload";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT, type I18nKey } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useShopStore } from "@/stores/shopStore";
import { useUIStore } from "@/stores/uiStore";
import { loadBusinessProfile, updateBusinessProfile } from "@/lib/businessProfile";
import { resolveImageUrl } from "@/lib/storage";
import { PAGE_DESIGNS, THERMAL_DESIGNS, type InvoiceDesign } from "@/lib/invoices";
import { INVOICE_DESIGN_KEYS } from "@/lib/invoiceDesignLabels";
import {
  DEFAULT_INVOICE_SETTINGS,
  loadInvoiceSettings,
  saveInvoiceSettings,
  type InvoicePaper,
  type InvoiceSettings,
  type InvoiceVisibleFields,
} from "@/lib/invoiceSettings";
import InvoiceSheet, { sampleInvoice, InvoiceDesignThumb, type ShopIdentity } from "@/components/invoices/InvoiceSheet";

/** The design a card selects, and the paper it prints on. */
interface DesignChoice {
  design: InvoiceDesign;
  paper: InvoicePaper;
}

const A4_CHOICES: DesignChoice[] = PAGE_DESIGNS.map((design) => ({ design, paper: "a4" }));
const A5_CHOICES: DesignChoice[] = (["classic", "modern", "elegant", "minimal"] as InvoiceDesign[]).map((design) => ({
  design,
  paper: "a5",
}));
const THERMAL_CHOICES: DesignChoice[] = THERMAL_DESIGNS.map((design) => ({ design, paper: "thermal" }));

const FIELDS: Array<{ key: keyof InvoiceVisibleFields; labelKey: I18nKey }> = [
  { key: "receiptNo", labelKey: "invoiceSettings.fieldReceiptNo" },
  { key: "date", labelKey: "invoiceSettings.fieldDate" },
  { key: "dueDate", labelKey: "invoiceSettings.fieldDueDate" },
  { key: "contact", labelKey: "invoiceSettings.fieldContact" },
  { key: "contactNumber", labelKey: "invoiceSettings.fieldContactNumber" },
  { key: "location", labelKey: "invoiceSettings.fieldLocation" },
  { key: "subtotal", labelKey: "invoiceSettings.fieldSubtotal" },
  { key: "discount", labelKey: "invoiceSettings.fieldDiscount" },
  { key: "tax", labelKey: "invoiceSettings.fieldTax" },
  { key: "amountPaid", labelKey: "invoiceSettings.fieldAmountPaid" },
  { key: "paymentAccount", labelKey: "invoiceSettings.fieldPaymentAccount" },
  { key: "signature", labelKey: "invoiceSettings.fieldSignature" },
  { key: "notes", labelKey: "invoiceSettings.fieldNotes" },
  { key: "logo", labelKey: "invoiceSettings.fieldLogo" },
];

/**
 * Invoice settings — the shop's paper, decided once.
 *
 * The screen is the order the decision is made in: whose mark is on the paper, which design it
 * uses, what is allowed to print, and the two notes at its head and foot. Every card renders the
 * real sheet, so nothing here is a swatch that prints differently.
 *
 * The design is a setting of the shop, not of one bill: a shop that settles on `Modern` should not
 * have to choose it again on every invoice. The print screen reads this record; the invoice form
 * starts from it.
 */
export default function InvoiceSettingsPage() {
  const t = useT();
  const navigate = useNavigate();
  const base = useShellBase();
  const { addToast } = useUIStore();
  const activeShopId = useShopStore((s) => s.activeShopId);
  const activeShopName = useShopStore((s) => s.activeShopName);

  const [settings, setSettings] = useState<InvoiceSettings>(DEFAULT_INVOICE_SETTINGS);
  const [shop, setShop] = useState<ShopIdentity>({ name: activeShopName ?? "", phone: null, address: null, logoUrl: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    loadInvoiceSettings(activeShopId)
      .then((loaded) => {
        if (alive) setSettings(loaded);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeShopId]);

  useEffect(() => {
    let alive = true;
    loadBusinessProfile()
      .then((profile) => {
        if (!alive || !profile) return;
        setShop({
          name: profile.shop.name ?? activeShopName ?? "",
          phone: profile.shop.phone ?? profile.shop.whatsapp_phone ?? null,
          address: profile.shop.address ?? null,
          logoUrl: resolveImageUrl(profile.shop.logo_url ?? profile.documents?.logo ?? null) ?? null,
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [activeShopName]);

  const sample = useMemo(() => sampleInvoice(settings.design), [settings.design]);

  function chooseDesign(choice: DesignChoice) {
    setSettings((prev) => ({ ...prev, design: choice.design, paper: choice.paper }));
  }

  function toggleField(key: keyof InvoiceVisibleFields) {
    setSettings((prev) => ({ ...prev, visible: { ...prev.visible, [key]: !prev.visible[key] } }));
  }

  async function saveLogo(url: string | null) {
    setShop((prev) => ({ ...prev, logoUrl: url }));
    try {
      await updateBusinessProfile({ logo: url ?? "" });
    } catch {
      addToast(t("invoiceSettings.failed"), "error");
    }
  }

  async function save() {
    if (!activeShopId || saving) return;
    setSaving(true);
    try {
      await saveInvoiceSettings(activeShopId, settings);
      addToast(t("invoiceSettings.saved"), "success");
    } catch {
      addToast(t("invoiceSettings.failed"), "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col bg-background w-full min-h-full">
        <StatusBar />
        <NavHeader title={t("invoiceSettings.title")} backTo={`${base}/invoices`} />
        <SkeletonList rows={4} />
      </div>
    );
  }

  const isChosen = (choice: DesignChoice) => settings.design === choice.design && settings.paper === choice.paper;

  function designGrid(choices: DesignChoice[], thermal = false) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {choices.map((choice) => {
          const chosen = isChosen(choice);
          return (
            <button
              key={`${choice.paper}-${choice.design}`}
              type="button"
              onClick={() => chooseDesign(choice)}
              aria-pressed={chosen}
              className="relative flex flex-col items-center gap-1.5 rounded-[var(--radius-tile)] p-2 ds-pressable"
              style={{
                background: "var(--surface-2)",
                border: `1.5px solid ${chosen ? "var(--brand-dark)" : "transparent"}`,
              }}
              data-testid={`invoice-design-${choice.design}-${choice.paper}`}
            >
              <InvoiceDesignThumb
                design={choice.design}
                paper={choice.paper}
                sample={{ ...sample, design: choice.design }}
                shop={shop}
                settings={settings}
                width={thermal ? 46 : 58}
                height={thermal ? 74 : 76}
              />
              <span className="text-11 font-semibold text-center leading-tight" style={{ color: "var(--text-primary)" }}>
                {t(INVOICE_DESIGN_KEYS[choice.design])}
              </span>
              {chosen && (
                <span
                  className="absolute top-1.5 end-1.5 flex size-4 items-center justify-center rounded-full"
                  style={{ background: "var(--brand-dark)", color: "var(--ink-fg, #fff)" }}
                >
                  <Check size={10} strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-background w-full min-h-full pb-8">
      <StatusBar />
      <NavHeader
        title={t("invoiceSettings.title")}
        backTo={`${base}/invoices`}
        right={
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            aria-label={t("invoiceSettings.preview")}
            data-testid="invoice-settings-preview"
            className="flex items-center justify-center size-11 rounded-full active:opacity-60"
            style={{ color: "var(--brand-dark)" }}
          >
            <Eye size={18} />
          </button>
        }
      />

      {/* 1. The mark at the top of the paper. */}
      <section className="px-4 pt-1">
        <ListCard>
          <ListRow
            title={t("invoiceSettings.logo")}
            description={t("invoiceSettings.tapToChange")}
            trailing={
              <ImageUpload
                bucket="company-logos"
                value={shop.logoUrl}
                onChange={(url) => void saveLogo(url)}
                shape="square"
                size={56}
              />
            }
          />
        </ListCard>
      </section>

      {/* 2. The paper itself, grouped by the size it prints on. */}
      <section className="px-4 pt-5" data-testid="invoice-settings-designs">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
            {t("invoiceSettings.design")}
          </p>
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="text-12 font-semibold ds-pressable"
            style={{ color: "var(--brand-dark)" }}
          >
            {t("invoiceSettings.preview")}
          </button>
        </div>
        <p className="text-11 mb-3" style={{ color: "var(--text-tertiary)" }}>
          {t("invoiceSettings.chooseDesign")}
        </p>

        <p className="text-11 font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          {t("invoiceSettings.paperA4")}
        </p>
        {designGrid(A4_CHOICES)}

        <p className="text-11 font-semibold mt-4 mb-2" style={{ color: "var(--text-secondary)" }}>
          {t("invoiceSettings.paperA5")}
        </p>
        {designGrid(A5_CHOICES)}

        <p className="text-11 font-semibold mt-4 mb-2" style={{ color: "var(--text-secondary)" }}>
          {t("invoiceSettings.paperThermal")}
        </p>
        {designGrid(THERMAL_CHOICES, true)}
      </section>

      {/* 3. What is allowed on the paper. */}
      <section className="px-4 pt-5" data-testid="invoice-settings-fields">
        <p className="ds-section-label mb-1" style={{ color: "var(--text-secondary)" }}>
          {t("invoiceSettings.visible")}
        </p>
        <p className="text-11 mb-2" style={{ color: "var(--text-tertiary)" }}>
          {t("invoiceSettings.visibleHint")}
        </p>
        <ListCard>
          {FIELDS.map((field) => (
            <ListRow
              key={field.key}
              title={t(field.labelKey)}
              trailing={
                <Switch
                  checked={settings.visible[field.key]}
                  onChange={() => toggleField(field.key)}
                  label={t(field.labelKey)}
                  testId={`invoice-field-${field.key}`}
                />
              }
            />
          ))}
        </ListCard>
      </section>

      {/* 4. The head and the foot. */}
      <section className="px-4 pt-5" data-testid="invoice-settings-header">
        <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
          {t("invoiceSettings.header")}
        </p>
        <ListCard>
          <ListRow
            title={t("invoiceSettings.headerToggle")}
            description={t("invoiceSettings.headerHint")}
            trailing={
              <Switch
                checked={settings.headerOn}
                onChange={(next) => setSettings((prev) => ({ ...prev, headerOn: next }))}
                label={t("invoiceSettings.header")}
                testId="invoice-header-toggle"
              />
            }
          />
        </ListCard>

        <label className="mt-4 flex flex-col gap-2">
          <span className="text-11 font-semibold tracking-wide" style={{ color: "var(--text-secondary)" }}>
            {t("invoiceSettings.headerNote")}
          </span>
          <textarea
            value={settings.headerNote}
            onChange={(e) => setSettings((prev) => ({ ...prev, headerNote: e.target.value }))}
            rows={3}
            maxLength={240}
            data-testid="invoice-header-note"
            className="w-full rounded-[var(--radius-field)] border px-4 py-3 text-13 outline-none"
            style={{ background: "var(--field-bg)", color: "var(--text-primary)", borderColor: "var(--field-border)", resize: "vertical" }}
          />
        </label>

        <label className="mt-4 flex flex-col gap-2">
          <span className="text-11 font-semibold tracking-wide" style={{ color: "var(--text-secondary)" }}>
            {t("invoiceSettings.footerNote")}
          </span>
          <textarea
            value={settings.footerNote}
            onChange={(e) => setSettings((prev) => ({ ...prev, footerNote: e.target.value }))}
            rows={3}
            maxLength={240}
            data-testid="invoice-footer-note"
            className="w-full rounded-[var(--radius-field)] border px-4 py-3 text-13 outline-none"
            style={{ background: "var(--field-bg)", color: "var(--text-primary)", borderColor: "var(--field-border)", resize: "vertical" }}
          />
        </label>
      </section>

      <div className="px-4 pt-6">
        <Button variant="cta" size="lg" fullWidth onClick={save} disabled={saving} testId="invoice-settings-save">
          <span className="flex items-center justify-center gap-2">
            {saving && <Loader2 size={16} className="animate-spin" />}
            {t("invoiceSettings.save")}
          </span>
        </Button>
      </div>

      <Sheet
        open={previewOpen}
        title={t("invoiceSettings.preview")}
        onClose={() => setPreviewOpen(false)}
      >
        <div className="px-3 pb-6" data-testid="invoice-settings-preview-sheet">
          <InvoiceSheet invoice={sample} shop={shop} design={settings.design} paper={settings.paper} settings={settings} />
        </div>
      </Sheet>
    </div>
  );
}
