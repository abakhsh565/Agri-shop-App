import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ImageUpload from "@/components/ui/ImageUpload";
import PaymentReminderCard from "@/components/ui/PaymentReminderCard";
import PaymentReminderSheet from "@/components/ui/PaymentReminderSheet";
import { SkeletonList } from "@/components/ui/Skeleton";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useProductsStore } from "@/stores/productsStore";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { fetchPurchases, fetchSupplierPayments, type SupplierPaymentEntry } from "@/lib/db";
import { digitsOnlyPhone, phoneFieldProps } from "@/lib/phoneInput";
import type { Purchase } from "@/types";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useReturnTo } from "@/lib/useReturnTo";
import { pkToday } from "@/lib/pkDate";
import {
  setPaymentReminderStatus,
  sortReminders,
  usePaymentReminderBook,
} from "@/lib/paymentReminders";
import {
  Phone,
  PackagePlus,
  Wallet,
  ShoppingCart,
  Plus,
  Pencil,
  Archive,
  X,
  MoreVertical,
  ChevronRight,
  Search,
  Bell,
  ReceiptText,
} from "lucide-react";

/**
 * One supplier, whole: who they are and what the business owes them.
 *
 * WHY ONE SCREEN. The record used to exist twice — `/companies/:id` held the identity, the
 * products they supply and the edit/archive actions, and `/settings/overview/suppliers/:id` held
 * the same name and logo again beside the payable, the bills, the payments and the reminders. So
 * the same supplier had two addresses, two summaries and two ways to reach the same payment form,
 * and a rename or a new reminder appeared on only one of them. This page is both jobs in one
 * place: the identity and actions of the directory, and the money of the payable book, with the
 * duplicated hero, payable figure, totals and payment CTA drawn once.
 *
 * WHAT IS KEPT, IN ONE HOME EACH:
 *   identity + contact details   the header line
 *   payable, billed, paid        the summary card (with the settled-bill progress)
 *   record payment / order stock the card's two actions
 *   bills                        the Bills tab — the purchase history is that list
 *   payments made                the Payments tab
 *   the owner's reminders        the Reminders tab
 *   products supplied            the Products tab
 *   edit, archive, add product   the overflow, unchanged
 *
 * THE OLD ADDRESS STILL LANDS HERE. `/settings/overview/suppliers/:id` redirects (see
 * `SupplierDetailRedirect` below), so a bookmark and the payable list keep working while the
 * supplier has exactly one URL.
 */
type Tab = "bills" | "payments" | "reminders" | "products";

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", timeZone: "Asia/Karachi",
  });
}

export default function CompanyDetailPage() {
  const { companyId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const base = useShellBase();
  const language = useThemeStore((s) => s.language);
  const t = useT();
  const isUrdu = language === "ur";

  // The suppliers list when the page is opened cold; the payable book when it is opened from
  // there, because that is the journey the reader is on.
  const returnTo = useReturnTo(`${base}/companies`);

  const companies = useCompaniesStore((s) => s.companies);
  const companiesReady = useCompaniesStore((s) => s.ready);
  const updateCompany = useCompaniesStore((s) => s.updateCompany);
  const archiveCompany = useCompaniesStore((s) => s.archiveCompany);
  const allProducts = useProductsStore((s) => s.products);
  const { addToast } = useUIStore();
  const isOwner = useAuthStore((s) => s.user?.membershipRole === "owner");

  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [payments, setPayments] = useState<SupplierPaymentEntry[] | null>(null);
  // The owner's own notes about this supplier's payments (0257), read from the book so this tab
  // and the Finance book cannot show two different lists.
  const reminders = usePaymentReminderBook();
  const [reminderOpen, setReminderOpen] = useState(false);
  const today = pkToday();

  const [tab, setTab] = useState<Tab>("bills");
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

  // One read for the three lists this page owns. A missing id stays a skeleton until the store
  // has loaded, because "not here yet" is not "not found".
  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    void fetchPurchases()
      .then((all) => {
        if (!alive) return;
        setPurchases(
          all
            .filter((p) => p.companyId === companyId)
            .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
        );
      })
      .catch(() => { if (alive) setPurchases([]); });
    void fetchSupplierPayments(companyId)
      .then((rows) => { if (alive) setPayments(rows); })
      .catch(() => { if (alive) setPayments([]); });
    return () => { alive = false; };
  }, [companyId]);

  const bills = useMemo(() => purchases ?? [], [purchases]);

  /** Bill id → its number, so a payment made at order time can name the delivery it paid for. */
  const billNumberById = useMemo(
    () => new Map(bills.map((bill) => [bill.id, bill.purchaseNumber])),
    [bills],
  );

  /**
   * How one payment describes itself. The advance booked with a delivery has no note — it has a
   * bill — so it says which one. Every payment recorded later keeps the note the owner typed.
   */
  function paymentDescription(payment: SupplierPaymentEntry): string | undefined {
    if (!payment.purchaseId) return payment.notes ?? undefined;
    const number = billNumberById.get(payment.purchaseId);
    return number
      ? t("supplierPayments.advanceOnBill", { number })
      : t("supplierPayments.advance");
  }


  if (!company) {
    return (
      <div
        className="flex flex-col w-full min-h-full"
        style={{ background: "var(--background)", color: "var(--text-primary)" }}
      >
        <StatusBar />
        <NavHeader title={t("company.title")} backTo={returnTo} />
        {companiesReady ? (
          <div className="flex flex-col items-center py-20 gap-2">
            <Search size={28} style={{ color: "var(--text-tertiary)" }} />
            <p className="text-13" style={{ color: "var(--text-secondary)" }}>{t("supplierDetail.notFound")}</p>
          </div>
        ) : (
          <SkeletonList rows={4} />
        )}
      </div>
    );
  }

  // Narrowed once for the handlers below: TypeScript does not carry the `if (!company)`
  // narrowing into closures, so they read this instead.
  const supplier = company;
  const products = allProducts.filter((p) => p.company === supplier.name);
  const billed = Math.max(0, supplier.totalPurchases);
  const due = Math.max(0, supplier.outstandingPayable);
  const paid = Math.max(0, billed - due);


  const supplierReminders = sortReminders(
    (reminders.rows ?? []).filter((r) => r.companyId === supplier.id),
    today,
  );
  // What is still open, for the tab's badge. A closed reminder stays in the list below but
  // must not keep the count alive.
  const openSupplierReminders = supplierReminders.filter((r) => r.status === "upcoming").length;

  /** The one line under the name: contact person, phone and address, whatever exists. */
  const identityLine = [supplier.contactPerson, supplier.phone, supplier.address]
    .filter(Boolean)
    .join(" · ");

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
      navigate(`${base}/companies`, { replace: true });
    } catch (e) {
      addToast(e instanceof Error ? e.message : t("errors.addCompanyFailed"), "error");
      setShowArchive(false);
    } finally {
      setArchiving(false);
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "bills", label: t("supplierDetail.tabBills") },
    { key: "payments", label: t("supplierDetail.tabPayments") },
    { key: "reminders", label: t("paymentBook.tab") },
    { key: "products", label: t("supplierDetail.tabProducts") },
  ];

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)", direction: isUrdu ? "rtl" : "ltr" }}
      data-testid="supplier-details-page"
    >
      <StatusBar />
      <NavHeader
        // The name belongs to the identity row below, where their mark sits beside it; repeating
        // it in the bar above printed the same word twice on the same screen.
        title={t("supplierDetail.title")}
        backTo={returnTo}
        right={
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={t("common.more")}
              data-testid="supplier-actions"
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
                    onClick={() => { setMenuOpen(false); navigate(`${base}/inventory/new?companyId=${supplier.id}`); }}
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

      <div className="flex flex-col gap-3.5 px-4 pt-3 pb-8">
        {/* ── The supplier's file ────────────────────────────────────────────────────────────
            A host profile, not a dashboard: the avatar, the name and the three numbers that say
            where the account stands, separated by rules instead of nested grey boxes. The boxes
            made the header read as four surfaces stacked inside a fifth; this is one surface and
            three figures on it (owner's correction, 2026-10-31). */}
        <div className="ds-card" data-testid="supplier-figures">
          <div className="flex flex-col items-center text-center">
            {supplier.logoUrl ? (
              <img
                src={supplier.logoUrl}
                alt={supplier.name}
                className="size-[76px] rounded-full object-cover shrink-0"
              />
            ) : (
              <span
                className="size-[76px] rounded-full flex items-center justify-center text-28 font-bold shrink-0"
                style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
              >
                {supplier.name.charAt(0).toUpperCase()}
              </span>
            )}
            <p className="text-22 font-bold leading-tight mt-3 break-words">{supplier.name}</p>
            <p className="text-12 mt-1" style={{ color: "var(--text-secondary)" }}>
              {identityLine || t("supplierDetail.supplier")}
            </p>
          </div>

          {/* Owed, paid, billed — three columns of one strip, told apart by a hairline. Amounts
              wrap rather than truncate, so a seven-figure balance can never be read as a
              smaller one on a narrow phone. */}
          <div className="mt-4 pt-4 flex items-stretch" style={{ borderTop: "1px solid var(--hairline)" }}>
            {[
              { key: "owe", label: t("supplierDetail.youOwe"), value: due },
              { key: "paid", label: t("common.paid"), value: paid },
              { key: "billed", label: t("supplierDetail.totalBilled"), value: billed },
            ].map((figure, index) => (
              <div
                key={figure.key}
                className="min-w-0 flex-1 px-1 text-center"
                style={index > 0 ? { borderInlineStart: "1px solid var(--hairline)" } : undefined}
              >
                <p
                  className="text-14 font-bold tabular-nums leading-tight break-words"
                  data-testid={figure.key === "owe" ? "supplier-due" : undefined}
                >
                  {formatCurrency(figure.value)}
                </p>
                <p className="text-10 mt-1 leading-tight" style={{ color: "var(--text-secondary)" }}>
                  {figure.label}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* The two things that move the balance, in one neutral pair. The white pill the payment
            action used to wear read as a light-theme control dropped into a dark screen; matching
            the order action keeps the pair calm, and the icon plus the bolder label still say
            which one the page exists for (owner's correction, 2026-10-31). */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigate(`${base}/payments/supplier/${supplier.id}`, { state: { from: location.pathname } })}
            data-testid="supplier-detail-pay"
            className="flex-[1.3] min-w-0 h-12 rounded-full flex items-center justify-center gap-2 text-13 font-bold active:opacity-80"
            style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
          >
            <Wallet size={16} className="shrink-0" />
            <span className="truncate">{t("supplierDetail.recordPayment")}</span>
          </button>
          <button
            type="button"
            onClick={() => navigate(`${base}/purchases/new?companyId=${supplier.id}`)}
            data-testid="supplier-detail-order"
            className="flex-1 min-w-0 h-12 rounded-full flex items-center justify-center gap-2 text-13 font-semibold active:opacity-80"
            style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
          >
            <ShoppingCart size={16} className="shrink-0" />
            <span className="truncate">{t("supplierDetail.orderStock")}</span>
          </button>
        </div>

        {/* Four lists, one at a time: what was bought, what was paid, the owner's reminders and
            what this supplier brings. Chips, so the row scrolls on a narrow phone rather than
            squeezing four labels into equal quarters. */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pt-1">
          {tabs.map((option) => {
            const selected = tab === option.key;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setTab(option.key)}
                aria-pressed={selected}
                data-testid={`supplier-tab-${option.key}`}
                className="shrink-0 h-9 px-4 rounded-full text-12 font-semibold transition-colors active:opacity-70"
                style={selected
                  ? { background: "var(--brand)", color: "var(--ink-fg)" }
                  : { background: "var(--surface-2)", color: "var(--text-secondary)" }}
              >
                {/* The count rides with the name, the way the payment book's own tabs say
                    "Upcoming · 2": a separate bell badge beside the word read as an alert and
                    doubled the icon already implied by the label (owner's correction,
                    2026-10-31). */}
                {option.key === "reminders" && openSupplierReminders > 0
                  ? `${option.label} · ${openSupplierReminders}`
                  : option.label}
              </button>
            );
          })}
        </div>

        {!companiesReady || purchases === null || payments === null || reminders.rows === null ? (
          <SkeletonList rows={3} />
        ) : tab === "bills" ? (
          bills.length === 0 ? (
            <div className="ds-card flex flex-col items-center gap-1.5 py-8 text-center" data-testid="supplier-bills-empty">
              <ReceiptText size={22} style={{ color: "var(--text-tertiary)" }} />
              <p className="text-13" style={{ color: "var(--text-secondary)" }}>
                {t("supplierDetail.noBills")}
              </p>
            </div>
          ) : (
            /* One row per bill: what it was, the day it arrived, and what is still owed on it.
               The plate this replaced repeated the bill amount, the amount unpaid, a progress bar
               and its percentage on every row, then a "Pay this bill" that opened the same form as
               the button above. */
            <ListCard>
              {bills.map((bill) => {
                const open = bill.outstandingPayable > 0;
                const units = bill.items.reduce((n, it) => n + it.qty, 0);
                return (
                  <ListRow
                    key={bill.id}
                    testId={`supplier-bill-${bill.id}`}
                    onClick={() => navigate(`${base}/purchases/${bill.id}`)}
                    title={bill.purchaseNumber}
                    meta={`${formatDate(bill.createdAt)}${units > 0 ? ` · ${units} ${t("common.units")}` : ""}`}
                    trailing={
                      <div className="text-end shrink-0">
                        <p
                          className="text-14 font-bold tabular-nums"
                          style={{ color: open ? "var(--text-primary)" : "var(--text-secondary)" }}
                        >
                          {formatCurrency(open ? bill.outstandingPayable : bill.totalAmount)}
                        </p>
                        <p
                          className="text-10 font-semibold mt-0.5"
                          style={{ color: open ? "var(--warning)" : "var(--brand-dark)" }}
                        >
                          {open ? t("payable.outstanding") : t("payable.paid")}
                        </p>
                      </div>
                    }
                  />
                );
              })}
            </ListCard>
          )
        ) : tab === "payments" ? (
          payments.length === 0 ? (
            <div className="ds-card flex flex-col items-center gap-1.5 py-8 text-center" data-testid="supplier-payments-empty">
              <Wallet size={22} style={{ color: "var(--text-tertiary)" }} />
              <p className="text-13" style={{ color: "var(--text-secondary)" }}>
                {t("supplierDetail.noPayments")}
              </p>
            </div>
          ) : (
            /* Money that has already left the shop, newest first, as rows rather than a card per
               payment: a column of amounts is what the owner is scanning for. */
            <ListCard>
              {payments.map((payment) => (
                <ListRow
                  key={payment.id}
                  testId={`supplier-payment-${payment.id}`}
                  tile={
                    <span
                      className="size-9 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: "var(--surface-2)", color: "var(--brand-dark)" }}
                    >
                      <Wallet size={15} />
                    </span>
                  }
                  title={formatCurrency(payment.amount)}
                  meta={`${shortDate(payment.createdAt)}${payment.recordedByName ? ` · ${payment.recordedByName}` : ""}`}
                  description={paymentDescription(payment)}
                />
              ))}
            </ListCard>
          )
        ) : tab === "reminders" ? (
          <div className="flex flex-col gap-2">
            {/* One row, read in two places: this tab and the payment-reminders book. The link
                makes the pair visible instead of leaving each screen looking like the only
                place the note exists (owner's request, 2026-10-31). */}
            <div className="flex items-center justify-between gap-3 px-1">
              <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                {t("paymentBook.title")}
              </p>
              <button
                type="button"
                onClick={() => navigate(`${base}/settings/hub/finance/reminders`)}
                data-testid="supplier-reminders-open-book"
                className="flex items-center gap-1 text-11 font-semibold shrink-0 active:opacity-70"
                style={{ color: "var(--brand-dark)" }}
              >
                {t("paymentBook.openBook")}
                <ChevronRight size={12} />
              </button>
            </div>

            {/* A note to the owner about money this supplier is owed, written where the bill is. */}
            {isOwner && (
              <button
                type="button"
                onClick={() => setReminderOpen(true)}
                data-testid="supplier-detail-reminder-add"
                className="w-full flex items-center gap-3 rounded-[var(--radius-card)] p-3 text-start active:opacity-70"
                style={{ background: "var(--tone-card)" }}
              >
                <span
                  className="size-9 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: "var(--surface-2)", color: "var(--brand-dark)" }}
                >
                  <Bell size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-13 font-bold">{t("paymentBook.add")}</span>
                  <span className="block text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    {t("paymentBook.addHint")}
                  </span>
                </span>
                <Plus size={16} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
              </button>
            )}

            {supplierReminders.length === 0 ? (
              <p className="py-6 text-13 text-center" style={{ color: "var(--text-secondary)" }}>
                {t("paymentBook.empty")}
              </p>
            ) : (
              supplierReminders.map((reminder) => (
                <PaymentReminderCard
                  key={reminder.id}
                  reminder={reminder}
                  today={today}
                  testId={`supplier-reminder-${reminder.id}`}
                  onStatus={
                    isOwner
                      ? async (status) => {
                          try {
                            await setPaymentReminderStatus(reminder.id, status);
                            reminders.retry();
                          } catch {
                            /* the card stays as it was; the book is the place to retry */
                          }
                        }
                      : undefined
                  }
                />
              ))
            )}
          </div>
        ) : products.length === 0 ? (
          <div className="ds-card flex flex-col items-center gap-1.5 py-8 text-center">
            <PackagePlus size={22} style={{ color: "var(--text-tertiary)" }} />
            <p className="text-13" style={{ color: "var(--text-secondary)" }}>
              {t("company.noProducts")}
            </p>
          </div>
        ) : (
          /* Their picture, then the name: the packet the owner already recognises on the shelf
             is easier to scan than a chip of words. */
          <ListCard>
            {products.map((p) => (
              <ListRow
                key={p.id}
                testId={`supplier-product-${p.id}`}
                onClick={() => navigate(`${base}/products/${p.id}`)}
                title={p.name}
                tile={
                  p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} className="size-10 rounded-[var(--radius-tile)] object-cover shrink-0" />
                  ) : (
                    <span
                      className="size-10 rounded-[var(--radius-tile)] flex items-center justify-center text-13 font-bold shrink-0"
                      style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                    >
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                  )
                }
                trailing={<ChevronRight size={14} style={{ color: "var(--text-tertiary)" }} className="shrink-0" />}
              />
            ))}
          </ListCard>
        )}
      </div>
      <PaymentReminderSheet
        open={reminderOpen}
        reminder={null}
        defaults={{
          kind: "supplier",
          companyId: supplier.id,
          title: t("paymentBook.titleToSupplier", { name: supplier.name }),
          amount: due > 0 ? due : null,
        }}
        onClose={() => setReminderOpen(false)}
        onSaved={() => { setReminderOpen(false); reminders.retry(); }}
      />

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
        message={t("common.archiveSupplierConfirm", { name: supplier.name })}
        confirmLabel={archiving ? t("common.saving") : t("common.delete")}
        onConfirm={handleArchive}
        onCancel={() => setShowArchive(false)}
        destructive
        loading={archiving}
      />
    </div>
  );
}

/**
 * The payable book's old address, kept alive.
 *
 * `/settings/overview/suppliers/:id` and `/companies/:id` were the same supplier; the merge gave
 * it one page, and this forwards the old address (with the list it came from, so back still works)
 * instead of letting a bookmark fall on a screen that no longer exists.
 */
export function SupplierDetailRedirect() {
  const { companyId } = useParams();
  const location = useLocation();
  return <Navigate to={`/admin/companies/${companyId}`} replace state={location.state} />;
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
    background: "var(--field-bg)",
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
