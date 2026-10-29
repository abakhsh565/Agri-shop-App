import { useEffect, useRef, useState } from "react";
import { Bell, Check } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import InlineSelect from "@/components/ui/InlineSelect";
import Button from "@/components/ui/Button";
import { useT } from "@/lib/i18n";
import { useUIStore } from "@/stores/uiStore";
import { pkToday } from "@/lib/pkDate";
import { REPEAT_KEY, type RepeatUnit } from "@/lib/financeEntries";
import {
  savePaymentReminder,
  type PaymentReminder,
} from "@/lib/paymentReminders";

/**
 * One payment the owner wants to be reminded about.
 *
 * SHAPE. The same sheet grammar as every other form in the app: a name, the facts the reminder
 * needs, and one save. It is a diary entry, not a message composer — there is no channel, no tone
 * and no recipient here, because this reminder is the owner's own.
 *
 * THE CADENCE IS OPTIONAL AND SMALL. Once, every day, week or month, and how many of those. An
 * alarm has a time and a repeat; so does this. A repeating reminder keeps the ORIGINAL day and
 * cadence in the database (0256) and the screen derives the next occurrence from them, so editing
 * a reminder never invents a table of shadow occurrences.
 *
 * The panel inside the sheet is `InlineSelect`, not a second sheet: two stacked overlays would be
 * two scrims and two Escape handlers for one answer.
 */
interface PaymentReminderSheetProps {
  open: boolean;
  /** The reminder being edited; null creates a new one. */
  reminder: PaymentReminder | null;
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

export default function PaymentReminderSheet({ open, reminder, onClose, onSaved }: PaymentReminderSheetProps) {
  const t = useT();
  const { addToast } = useUIStore();

  const [title, setTitle] = useState("");
  const [person, setPerson] = useState("");
  const [amount, setAmount] = useState("");
  const [dueOn, setDueOn] = useState(pkToday());
  const [dueTime, setDueTime] = useState("09:00");
  const [repeatUnit, setRepeatUnit] = useState<RepeatUnit>("none");
  const [repeatEvery, setRepeatEvery] = useState("1");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  // Reopening starts from the reminder this sheet was opened for, never from an abandoned draft.
  useEffect(() => {
    if (!open) return;
    setError("");
    setSaving(false);
    submittingRef.current = false;
    setTitle(reminder?.title ?? "");
    setPerson(reminder?.person ?? "");
    setAmount(reminder?.amount == null ? "" : String(reminder.amount));
    setDueOn(reminder?.dueOn ?? pkToday());
    setDueTime(reminder?.dueTime ?? "09:00");
    setRepeatUnit(reminder?.repeatUnit ?? "none");
    setRepeatEvery(String(reminder?.repeatEvery ?? 1));
  }, [open, reminder]);

  async function handleSave() {
    if (submittingRef.current) return;
    if (!title.trim()) {
      setError(t("cashPosition.reminderNameRequired"));
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
        person,
        amount: parsed,
        dueOn,
        dueTime,
        repeatEvery: Math.min(60, Math.max(1, Number(repeatEvery) || 1)),
        repeatUnit,
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

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-12 font-semibold" style={labelStyle}>{t("cashPosition.reminderPerson")}</p>
            <span className="text-11" style={optionalStyle}>{t("finance.optional")}</span>
          </div>
          <div className="ds-field">
            <input
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              maxLength={120}
              placeholder={t("cashPosition.reminderPersonPlaceholder")}
              aria-label={t("cashPosition.reminderPerson")}
              data-testid="payment-reminder-person"
              className="flex-1 min-w-0 h-full bg-transparent outline-none text-13"
              style={{ color: "var(--text-primary)" }}
            />
          </div>
        </div>

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
            <input
              type="date"
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
              aria-label={t("cashPosition.reminderDate")}
              data-testid="payment-reminder-date"
              className="w-full text-13"
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
