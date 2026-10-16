import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ImageUpload from "@/components/ui/ImageUpload";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useProductsStore } from "@/stores/productsStore";
import { useUIStore } from "@/stores/uiStore";
import { fetchPurchases } from "@/lib/db";
import { digitsOnlyPhone, phoneFieldProps } from "@/lib/phoneInput";
import type { Purchase } from "@/types";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { Phone, User, MapPin, PackagePlus, Wallet, ShoppingCart, Plus, Pencil, Archive, X, MoreVertical, ChevronRight, Search } from "lucide-react";

export default function CompanyDetailPage() {
  const { companyId } = useParams();
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const t = useT();
  const isUrdu = language === "ur";

  const companies = useCompaniesStore((s) => s.companies);
  const updateCompany = useCompaniesStore((s) => s.updateCompany);
  const archiveCompany = useCompaniesStore((s) => s.archiveCompany);
  const allProducts = useProductsStore((s) => s.products);
  const { addToast } = useUIStore();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [showEdit, setShowEdit] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [edit, setEdit] = useState({ name: "", contactPerson: "", phone: "", address: "" });
  const [editLogo, setEditLogo] = useState<string | null>(null);
  const [editError, setEditError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const company = companies.find((c) => c.id === companyId);
  // Until the store has loaded, a missing supplier means "not here yet" — rendering
  // "not found" then is a false claim about data that has not arrived.
  const companiesReady = useCompaniesStore((s) => s.ready);

  useEffect(() => {
    if (!companyId) return;
    fetchPurchases().then((all) =>
      setPurchases(
        all
          .filter((p) => p.companyId === companyId)
          .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
      ),
    );
  }, [companyId]);

  if (!company) return (
    <div style={{ background: "var(--background)", color: "var(--text-primary)" }} className="flex flex-col min-h-full">
      <StatusBar />
      <NavHeader title={t("company.title")} />
      {companiesReady ? (
        <div className="flex flex-col items-center py-20 gap-2">
          <Search size={28} className="mx-auto block" style={{ color: "var(--text-tertiary)" }} />
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("company.notFound")}</p>
        </div>
      ) : (
        <SkeletonList rows={4} />
      )}
    </div>
  );

  // Narrowed once for the handlers below: TypeScript does not carry the `if (!company)`
  // narrowing into closures, so they read this instead.
  const supplier = company;
  const products = allProducts.filter((p) => p.company === supplier.name);
  const totalPaid = supplier.totalPurchases - supplier.outstandingPayable;

  function openEdit() {
    setEdit({
      name: supplier.name,
      contactPerson: supplier.contactPerson ?? "",
      phone: supplier.phone ?? "",
      address: supplier.address ?? "",
    });
    setEditLogo(supplier.logoUrl ?? null);
    setEditError("");
    setShowEdit(true);
  }

  async function handleSaveEdit() {
    setEditError("");
    if (!edit.name.trim()) { setEditError(t("copy.enterCompanyName")); return; }
    // A ref, not `saving`: React batches, so two taps in one task both read the
    // pre-render `false` and the edit is sent twice.
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await updateCompany(supplier.id, {
        name: edit.name.trim(),
        contactPerson: edit.contactPerson.trim(),
        phone: edit.phone.trim(),
        address: edit.address.trim(),
        logoUrl: editLogo ?? undefined,
      });
      // Products are linked to the supplier by name, so a rename moves them with it.
      await useProductsStore.getState().load();
      addToast(t("copy.updated", { name: edit.name.trim() }), "success");
      setShowEdit(false);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : t("errors.addCompanyFailed"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleArchive() {
    setArchiving(true);
    try {
      await archiveCompany(supplier.id);
      addToast(t("company.archived", { name: supplier.name }), "success");
      navigate("/admin/companies", { replace: true });
    } catch (e) {
      addToast(e instanceof Error ? e.message : t("errors.addCompanyFailed"), "error");
      setShowArchive(false);
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader
        title={supplier.name}
        right={
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={t("common.more")}
              className="flex items-center justify-center size-9 rounded-full active:opacity-60 transition-opacity"
              style={{ color: "var(--text-primary)" }}
            >
              <MoreVertical size={18} />
            </button>
            {menuOpen && (
              <>
                {/* Tap anywhere else to dismiss */}
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div
                  className="absolute z-50 mt-1 min-w-[190px] rounded-[var(--radius-card)] overflow-hidden shadow-lg"
                  style={{ background: "var(--surface)", border: "1px solid var(--divider)", [isUrdu ? "left" : "right"]: 0 }}
                >
                  <MenuItem
                    icon={Plus}
                    label={t("company.addProduct")}
                    onClick={() => { setMenuOpen(false); navigate(`/admin/inventory/new?companyId=${supplier.id}`); }}
                  />
                  <MenuItem
                    icon={Pencil}
                    label={t("common.edit")}
                    onClick={() => { setMenuOpen(false); openEdit(); }}
                  />
                  <MenuItem
                    icon={Archive}
                    label={t("company.removeSupplier")}
                    destructive
                    onClick={() => { setMenuOpen(false); setShowArchive(true); }}
                  />
                </div>
              </>
            )}
          </div>
        }
      />

      {/* Logo + Name hero */}
      <div className="flex flex-col items-center pt-4 pb-1">
        {company.logoUrl ? (
          <img src={company.logoUrl} alt={company.name} className="size-[72px] rounded-[var(--radius-card)] object-cover"
            style={{ border: "2px solid var(--divider)" }} />
        ) : (
          <div className="size-[72px] rounded-[var(--radius-card)] flex items-center justify-center text-2xl font-bold"
            style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "2px solid var(--divider)" }}>
            {company.name ? company.name.charAt(0) : "?".toUpperCase()}
          </div>
        )}
      </div>

      {/* Financial summary — clean white card */}
      <div className="px-5 pt-4">
        <div className="rounded-[var(--radius-card)] p-6 text-center" style={{ background: "var(--tone-card)" }}>
          <p className="text-11 font-semibold tracking-wide" style={{ color: "var(--text-secondary)" }}>
            {t("company.currentPayable")}
          </p>
          <p className="text-34 font-extrabold mt-1 tracking-tight" style={{ color: company.outstandingPayable > 0 ? "var(--error, #ef4444)" : "var(--text-primary)" }}>
            {formatCurrency(company.outstandingPayable)}
          </p>
        </div>
      </div>

      {/* Quick Actions — dark primary CTA */}
      <div className="px-5 pt-4 flex gap-3">
        <button
          onClick={() => navigate(`/admin/purchases/new?companyId=${company.id}`)}
          className="flex-1 h-[46px] rounded-[var(--radius-card)] text-13 font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          style={{ background: "#1a1a1a", color: "#fff" }}
        >
          <ShoppingCart size={16} /> {t("company.orderStock")}
        </button>
        <button
          onClick={() => navigate(`/admin/payments/supplier/${company.id}`)}
          className="flex-1 h-[46px] rounded-[var(--radius-card)] text-13 font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          style={{ background: "var(--surface)", color: "var(--text-primary)", border: "1px solid var(--divider)" }}
        >
          <Wallet size={16} /> {t("company.recordPayment")}
        </button>
      </div>

      {/* Totals — clean side-by-side cards */}
      <div className="px-5 pt-4 flex gap-3">
        <div className="ds-card flex-1">
          <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>{t("company.totalPurchased")}</p>
          <p className="text-15 font-bold mt-1" style={{ color: "var(--text-primary)" }}>{formatCurrency(company.totalPurchases)}</p>
        </div>
        <div className="ds-card flex-1">
          <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>{t("company.totalPaid")}</p>
          <p className="text-15 font-bold mt-1" style={{ color: "var(--brand-dark, #16a34a)" }}>{formatCurrency(totalPaid)}</p>
        </div>
      </div>

      {/* Contact — clean card */}
      {(company.contactPerson || company.phone || company.address) && (
        <div className="px-5 pt-6">
          <p className="text-12 font-semibold mb-2.5" style={{ color: "var(--text-secondary)" }}>{t("company.contact")}</p>
          <div className="overflow-hidden rounded-[var(--radius-card)]" style={{ border: "1px solid var(--divider)" }}>
            {company.contactPerson && <ContactRow icon={User} value={company.contactPerson} />}
            {company.phone && <ContactRow icon={Phone} value={company.phone} />}
            {company.address && <ContactRow icon={MapPin} value={company.address} last />}
          </div>
        </div>
      )}

      {/* Products supplied — clean chips */}
      <div className="px-5 pt-6">
        <p className="text-12 font-semibold mb-2.5" style={{ color: "var(--text-secondary)" }}>
          {t("company.productsSupplied", { count: String(products.length) })}
        </p>
        {products.length === 0 ? (
          <p className="text-13" style={{ color: "var(--text-secondary)" }}>{t("company.noProducts")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {products.map((p) => (
              <button key={p.id} onClick={() => navigate(`/admin/products/${p.id}`)}
                className="text-12 font-medium px-3.5 py-[7px] rounded-full active:scale-[0.97] transition-transform"
                style={{ background: "var(--surface)", color: "var(--text-primary)", border: "1px solid var(--divider)" }}>
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Purchase history — clean list cards */}
      <div className="px-5 pt-6 pb-8">
        <p className="text-12 font-semibold mb-2.5" style={{ color: "var(--text-secondary)" }}>{t("company.purchaseHistory")}</p>
        {purchases.length === 0 ? (
          <p className="text-13" style={{ color: "var(--text-secondary)" }}>{t("company.noPurchases")}</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {purchases.map((p) => (
              <button key={p.id} onClick={() => navigate(`/admin/purchases/${p.id}`)}
                className="ds-card w-full flex items-center justify-between text-start active:scale-[0.99] transition-transform">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="size-9 rounded-[var(--radius-tile)] flex items-center justify-center shrink-0"
                    style={{ background: "rgba(132,204,22,0.12)", color: "var(--brand-dark, #16a34a)" }}>
                    <PackagePlus size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-13 font-semibold" style={{ color: "var(--text-primary)" }}>{p.purchaseNumber}</p>
                    <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                      {formatDate(p.createdAt)} · {p.items.reduce((n, it) => n + it.qty, 0)} {t("common.units")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="text-end">
                    <p className="text-13 font-bold" style={{ color: "var(--text-primary)" }}>{formatCurrency(p.totalAmount)}</p>
                    {p.outstandingPayable > 0 && (
                      <p className="text-11 mt-0.5" style={{ color: "var(--error, #ef4444)" }}>{formatCurrency(p.outstandingPayable)} {t("company.payable")}</p>
                    )}
                  </div>
                  <ChevronRight size={16} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {showEdit && (
        <EditSupplierSheet
          edit={edit}
          setEdit={setEdit}
          logo={editLogo}
          setLogo={setEditLogo}
          error={editError}
          saving={saving}
          onSave={handleSaveEdit}
          onClose={() => !saving && setShowEdit(false)}
        />
      )}

      <ConfirmDialog
        open={showArchive}
        title={t("company.removeSupplier")}
        message={t("common.archiveSupplierConfirm", { name: company.name })}
        confirmLabel={archiving ? t("common.saving") : t("common.delete")}
        onConfirm={handleArchive}
        onCancel={() => setShowArchive(false)}
        destructive
        loading={archiving}
      />
    </div>
  );
}

function MenuItem({
  icon: Icon, label, onClick, destructive,
}: {
  icon: typeof Phone;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 text-start active:opacity-60 transition-opacity"
      style={{ borderBottom: "1px solid var(--divider)", color: destructive ? "var(--error, #ef4444)" : "var(--text-primary)" }}
    >
      <Icon size={16} />
      <span className="text-13 font-semibold">{label}</span>
    </button>
  );
}

function EditSupplierSheet({
  edit, setEdit, logo, setLogo, error, saving, onSave, onClose,
}: {
  edit: { name: string; contactPerson: string; phone: string; address: string };
  setEdit: (v: { name: string; contactPerson: string; phone: string; address: string }) => void;
  logo: string | null;
  setLogo: (v: string | null) => void;
  error: string;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const fieldStyle = {
    background: "var(--surface-2)",
    border: "1px solid var(--divider)",
    color: "var(--text-primary)",
  } as const;
  const labelCls = "ds-section-label mb-2";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      style={{ background: "var(--scrim)" }}
      onClick={() => !saving && onClose()}
    >
      <div
        className="w-full max-h-[90vh] overflow-y-auto rounded-t-[22px] p-5 pb-7"
        style={{ background: "var(--tone-sheet)", direction: isUrdu ? "rtl" : "ltr" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <p className="text-base font-bold" style={{ color: "var(--text-primary)" }}>{t("company.editSupplier")}</p>
          <button onClick={onClose} disabled={saving} style={{ color: "var(--text-secondary)" }}>
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex justify-center">
            <ImageUpload bucket="company-logos" value={logo} onChange={setLogo} shape="square" label={t("company.addLogo")} />
          </div>

          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("company.name")}</p>
            <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none" style={fieldStyle} />
          </div>

          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("company.contact")}</p>
            <input value={edit.contactPerson} onChange={(e) => setEdit({ ...edit, contactPerson: e.target.value })}
              placeholder={t("company.ownerPlaceholder")} className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none" style={fieldStyle} />
          </div>

          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("addCustomer.phone")}</p>
            <input {...phoneFieldProps()} value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: digitsOnlyPhone(e.target.value) })}
              placeholder="03001234567" className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none" style={fieldStyle} />
          </div>

          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("common.address")}</p>
            <input value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })}
              placeholder={t("company.streetCityPlaceholder")} className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none" style={fieldStyle} />
          </div>

          {error && <p className="text-xs" style={{ color: "var(--error)" }}>{error}</p>}
        </div>

        <button
          onClick={onSave}
          disabled={saving}
          className="w-full h-12 mt-5 rounded-full font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
        >
          {saving ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </div>
  );
}

function ContactRow({ icon: Icon, value, last }: { icon: typeof Phone; value: string; last?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5"
      style={{ borderBottom: last ? "none" : "1px solid var(--divider)", background: "var(--surface)" }}>
      <div className="size-7 rounded-full flex items-center justify-center shrink-0"
        style={{ background: "rgba(132,204,22,0.1)" }}>
        <Icon size={14} style={{ color: "var(--brand-dark, #16a34a)" }} />
      </div>
      <span className="text-13" style={{ color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
}
