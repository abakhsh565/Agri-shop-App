import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Check } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import DateField from "@/components/ui/DateField";
import InlineSelect from "@/components/ui/InlineSelect";
import SelectorField from "@/components/ui/SelectorField";
import Button from "@/components/ui/Button";
import { useT } from "@/lib/i18n";
import { useUIStore } from "@/stores/uiStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { pkToday } from "@/lib/pkDate";
import { REPEAT_KEY, type RepeatUnit } from "@/lib/financeEntries";
import {
  savePaymentReminder,
  type PaymentReminder,
  type PaymentReminderKind,
} from "@/lib/paymentReminders";

/**
 * One payment the owner wants to be reminded about.
 *
 * SHAPE. The same sheet grammar as every other form in the app: a name, the facts the reminder
 * needs, and one save. It is a diary entry, not a message composer — there is no channel, no tone
 * and no recipient here, because this reminder is the owner's own.
 *
 * WHAT IT IS ABOUT COMES FIRST (0257). Customer, supplier or neither. The choice decides which
 * record the sheet asks for, and the record — not a typed name — is what the reminder is stored
 * against, so "what am I chasing this supplier about" has an answer.
 *
 * THE CADENCE IS OPTIONAL AND SMALL. Once, every day, week or month, and how many of those. An
 * alarm has a time and a repeat; so does this. A repeating reminder keeps the ORIGINAL day and
 * cadence in the database and the screen derives the next occurrence from them, so editing a
 * reminder never invents a table of shadow occurrences.
 *
 * The panel inside the sheet is `InlineSelect` and the parties are `SelectorField` panels, not a
 * second sheet: two stacked overlays would be two scrims and two Escape handlers for one answer.
 */
export interface PaymentReminderDefaults {
  kind?: PaymentReminderKind;
  customerId?: string | null;
  companyId?: string | null;
  title?: string;
  amount?: number | null;
  person?: string;
}

interface PaymentReminderSheetProps {
  open: boolean;
  /** The reminder being edited; null creates a new one. */
  reminder: PaymentReminder | null;
  /** Values a new reminder starts from — a row's party, name and balance. */
  defaults?: PaymentReminderDefaults;
  onClose: () => void;
  /** Called after the database accepted the row, so the screen can re-read it. */
  onSaved: () => void;
}

const REPEATS: RepeatUnit[] = ["none", "day", "week", "month"];

const REPEAT_UNIT_KEY = {
  day: "finance.repeat.days",
  week: "finance.repeat.weeks",
  month: "finance.repeat.months",
} as const;

const REPEAT_UNIT_ONE_KEY = {
  day: "finance.repeat.unitDay",
  week: "finance.repeat.unitWeek",
  month: "finance.repeat.unitMonth",
} as const;

const KINDS: { key: PaymentReminderKind; labelKey: "paymentBook.kindCustomer" | "paymentBook.kindSupplier" | "paymentBook.kindGeneral" }[] = [
  { key: "customer", labelKey: "paymentBook.kindCustomer" },
  { key: "supplier", labelKey: "paymentBook.kindSupplier" },
  { key: "general", labelKey: "paymentBook.kindGeneral" },
];

export default function PaymentReminderSheet({
  open,
  reminder,
  defaults,
  onClose,
  onSaved,
}: PaymentReminderSheetProps) {
  const t = useT();
  const { addToast } = useUIStore();
  const customers = useCustomersStore((s) => s.customers);
  const customersReady = useCustomersStore((s) => s.ready);
  const loadCustomers = useCustomersStore((s) => s.load);
  const companies = useCompaniesStore((s) => s.companies);
  const companiesReady = useCompaniesStore((s) => s.ready);
  const loadCompanies = useCompaniesStore((s) => s.load);

  const [kind, setKind] = useState<PaymentReminderKind>("general");
  const [customerId, setCustomerId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [title, setTitle] = useState("");
  const [person, setPerson] = useState("");
  const [amount, setAmount] = useState("");
  const [dueOn, setDueOn] = useState(pkToday());
  const [dueTime, setDueTime] = useState("09:00");
  const [repeatUnit, setRepeatUnit] = useState<RepeatUnit>("none");
  const [repeatEvery, setRepeatEvery] = useState("1");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  // The party lists are only needed when the sheet asks for one, but they are already cached by
  // the screens that open it; loading here covers the book, which may be the first screen after
  // sign-in.
  useEffect(() => {
    if (!open) return;
    if (!customersReady) void loadCustomers();
    if (!companiesReady) void loadCompanies();
  }, [open, customersReady, loadCustomers, companiesReady, loadCompanies]);

  // The prefill is read ONCE, when the sheet opens. Callers build `defaults` inline, so depending
  // on the object itself would reset the form on every parent render — the owner's typing would
  // vanish under the keyboard.
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  // Reopening starts from the reminder this sheet was opened for, then from the row that opened
  // it, never from an abandoned draft.
  useEffect(() => {
    if (!open) return;
    const start = defaultsRef.current;
    setError("");
    setSaving(false);
    submittingRef.current = false;
    setKind(reminder?.kind ?? start?.kind ?? "general");
    setCustomerId(reminder?.customerId ?? start?.customerId ?? "");
    setCompanyId(reminder?.companyId ?? start?.companyId ?? "");
    setTitle(reminder?.title ?? start?.title ?? "");
    setPerson(reminder?.kind === "general" ? reminder.person ?? "" : start?.person ?? "");
    setAmount(
      reminder?.amount != null
        ? String(reminder.amount)
        : start?.amount != null
          ? String(start.amount)
          : "",
    );
    setDueOn(reminder?.dueOn ?? pkToday());
    setDueTime(reminder?.dueTime ?? "09:00");
    setRepeatUnit(reminder?.repeatUnit ?? "none");
    setRepeatEvery(String(reminder?.repeatEvery ?? 1));
    setNotes(reminder?.notes ?? "");
  }, [open, reminder]);

  const customerOptions = useMemo(
    () =>
      [...customers]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ value: c.id, label: c.name, meta: c.phone })),
    [customers],
  );

  const supplierOptions = useMemo(
    () =>
      [...companies]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ value: c.id, label: c.name, meta: c.phone })),
    [companies],
  );

  /** Choosing the kind clears the party the new kind cannot use. */
  function chooseKind(next: PaymentReminderKind) {
    setKind(next);
    setError("");
    if (next !== "customer") setCustomerId("");
    if (next !== "supplier") setCompanyId("");
    if (next !== "general") setPerson("");
  }

  /** Picking the record names the reminder after it, until the owner writes their own name. */
  function chooseCustomer(id: string) {
    setCustomerId(id);
    setError("");
    const chosen = customers.find((c) => c.id === id);
    if (chosen && !title.trim()) setTitle(t("paymentBook.titleFromCustomer", { name: chosen.name }));
  }

  function chooseSupplier(id: string) {
    setCompanyId(id);
    setError("");
    const chosen = companies.find((c) => c.id === id);
    if (chosen && !title.trim()) setTitle(t("paymentBook.titleToSupplier", { name: chosen.name }));
  }

  async function handleSave() {
    if (submittingRef.current) return;
    if (!title.trim()) {
      setError(t("cashPosition.reminderNameRequired"));
      return;
    }
    if (kind === "customer" && !customerId) {
      setError(t("paymentBook.customerRequired"));
      return;
    }
    if (kind === "supplier" && !companyId) {
      setError(t("paymentBook.supplierRequired"));
      return;
    }
    if (!dueOn) {
      setError(t("cashPosition.reminderDateRequired"));
      return;
    }
    const parsed = amount.trim() ? Number(amount) : null;
    if (parsed !== null && (!Number.isFinite(parsed) || parsed <= 0)) {
      setError(t("cashPosition.reminderAmountError"));
      return;
    }

    submittingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await savePaymentReminder({
        id: reminder?.id ?? null,
        title,
        kind,
        customerId: kind === "customer" ? customerId : null,
        companyId: kind === "supplier" ? companyId : null,
        person,
        amount: parsed,
        dueOn,
        dueTime,
        repeatEvery: Math.min(60, Math.max(1, Number(repeatEvery) || 1)),
        repeatUnit,
        notes,
      });
      addToast(t("cashPosition.reminderSaved"), "success");
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("cashPosition.reminderFailed"));
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  const labelStyle = { color: "var(--text-secondary)" } as const;
  const optionalStyle = { color: "var(--text-tertiary)" } as const;

  return (
    <Sheet
      open={open}
      title={reminder ? t("cashPosition.editReminder") : t("cashPosition.setReminder")}
      onClose={onClose}
    >
      <div className="px-5 flex flex-col gap-4" data-testid="payment-reminder-sheet">
        <div className="flex flex-col gap-2">
          <p className="text-12 font-semibold" style={labelStyle}>{t("paymentBook.about")}</p>
          <div className="flex gap-2" role="group" aria-label={t("paymentBook.about")}>
            {KINDS.map((option) => {
              const selected = kind === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => chooseKind(option.key)}
                  aria-pressed={selected}
                  data-testid={`payment-reminder-kind-${option.key}`}
                  className="flex-1 h-9 rounded-full text-12 font-semibold active:opacity-70"
                  style={
                    selected
                      ? { background: "var(--brand)", color: "#0a0a0a" }
                      : { background: "var(--tone-sunken)", color: "var(--text-secondary)" }
                  }
                >
                  {t(option.labelKey)}
                </button>
              );
            })}
          </div>
        </div>

        {kind === "customer" && (
          <div className="flex flex-col gap-2">
            <p className="text-12 font-semibold" style={labelStyle}>{t("paymentBook.customer")}</p>
            <SelectorField
              value={customerId}
              options={customerOptions}
              placeholder={t("paymentBook.chooseCustomer")}
              title={t("paymentBook.customer")}
              onChange={chooseCustomer}
              searchable
              emptyLabel={t("paymentBook.noCustomers")}
            />
          </div>
        )}

        {kind === "supplier" && (
          <div className="flex flex-col gap-2">
            <p className="text-12 font-semibold" style={labelStyle}>{t("paymentBook.supplier")}</p>
            <SelectorField
              value={companyId}
              options={supplierOptions}
              placeholder={t("paymentBook.chooseSupplier")}
              title={t("paymentBook.supplier")}
              onChange={chooseSupplier}
              searchable
              emptyLabel={t("paymentBook.noSuppliers")}
            />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <p className="text-12 font-semibold" style={labelStyle}>{t("cashPosition.reminderName")}</p>
          <div className="ds-field">
            <Bell size={16} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (error) setError("");
              }}
              maxLength={80}
              placeholder={t("cashPosition.reminderNamePlaceholder")}
              aria-label={t("cashPosition.reminderName")}
              data-testid="payment-reminder-title"
              className="flex-1 min-w-0 h-full bg-transparent outline-none text-13"
              style={{ color: "var(--text-primary)" }}
            />
          </div>
        </div>

        {kind === "general" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-12 font-semibold" style={labelStyle}>{t("paymentBook.who")}</p>
              <span className="text-11" style={optionalStyle}>{t("finance.optional")}</span>
            </div>
            <div className="ds-field">
              <input
                value={person}
                onChange={(e) => setPerson(e.target.value)}
                maxLength={120}
                placeholder={t("cashPosition.reminderPersonPlaceholder")}
                aria-label={t("paymentBook.who")}
                data-testid="payment-reminder-person"
                className="flex-1 min-w-0 h-full bg-transparent outline-none text-13"
                style={{ color: "var(--text-primary)" }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-12 font-semibold" style={labelStyle}>{t("cashPosition.reminderAmount")}</p>
            <span className="text-11" style={optionalStyle}>{t("finance.optional")}</span>
          </div>
          <div className="ds-field">
            <span className="text-13 font-semibold me-2 shrink-0" style={{ color: "var(--text-secondary)" }}>Rs</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              placeholder="0.00"
              aria-label={t("cashPosition.reminderAmount")}
              data-testid="payment-reminder-amount"
              className="flex-1 h-full bg-transparent outline-none text-13 tabular-nums"
              style={{ color: "var(--text-primary)" }}
            />
          </div>
        </div>

        <div className="flex gap-3">
          <label className="flex-1 min-w-0 flex flex-col gap-2">
            <span className="text-12 font-semibold" style={labelStyle}>{t("cashPosition.reminderDate")}</span>
            <DateField
              value={dueOn}
              onChange={setDueOn}
              ariaLabel={t("cashPosition.reminderDate")}
              testId="payment-reminder-date"
            />
          </label>
          <label className="flex-1 min-w-0 flex flex-col gap-2">
            <span className="text-12 font-semibold" style={labelStyle}>{t("cashPosition.reminderTime")}</span>
            <input
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              aria-label={t("cashPosition.reminderTime")}
              data-testid="payment-reminder-time"
              className="w-full text-13"
            />
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-12 font-semibold" style={labelStyle}>{t("finance.repeat")}</p>
          <InlineSelect
            value={repeatUnit}
            options={REPEATS.map((value) => ({ value, label: t(REPEAT_KEY[value]) }))}
            onChange={(value) => setRepeatUnit(value as RepeatUnit)}
            label={t("finance.repeat")}
            testId="payment-reminder-repeat"
          />
          {repeatUnit !== "none" && (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-12 shrink-0" style={labelStyle}>{t("finance.repeat.every")}</span>
              <div className="ds-field" style={{ width: 84 }}>
                <input
                  value={repeatEvery}
                  onChange={(e) => setRepeatEvery(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
                  onBlur={() => setRepeatEvery(String(Math.min(60, Math.max(1, Number(repeatEvery) || 1))))}
                  inputMode="numeric"
                  aria-label={t("finance.repeat.every")}
                  data-testid="payment-reminder-repeat-every"
                  className="flex-1 min-w-0 h-full bg-transparent outline-none text-13 tabular-nums text-center"
                  style={{ color: "var(--text-primary)" }}
                />
              </div>
              <span className="text-12" style={labelStyle}>
                {t(
                  (Number(repeatEvery) || 1) <= 1
                    ? REPEAT_UNIT_ONE_KEY[repeatUnit as "day" | "week" | "month"]
                    : REPEAT_UNIT_KEY[repeatUnit as "day" | "week" | "month"],
                )}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-12 font-semibold" style={labelStyle}>{t("paymentBook.notes")}</p>
            <span className="text-11" style={optionalStyle}>{t("finance.optional")}</span>
          </div>
          <div className="ds-field" style={{ alignItems: "flex-start", paddingTop: 10, paddingBottom: 10 }}>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={280}
              placeholder={t("paymentBook.notesPlaceholder")}
              aria-label={t("paymentBook.notes")}
              data-testid="payment-reminder-notes"
              className="flex-1 min-w-0 bg-transparent outline-none text-13"
              style={{ color: "var(--text-primary)" }}
            />
          </div>
        </div>

        {error && (
          <p className="text-11" style={{ color: "var(--error)" }} data-testid="payment-reminder-error">
            {error}
          </p>
        )}

        <Button fullWidth size="lg" onClick={handleSave} loading={saving} disabled={!title.trim()} testId="payment-reminder-save">
          <Check size={18} className="me-2" />
          {reminder ? t("cashPosition.reminderUpdate") : t("cashPosition.reminderSave")}
        </Button>
      </div>
    </Sheet>
  );
}
