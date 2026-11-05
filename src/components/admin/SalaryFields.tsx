import type { ReactNode } from "react";
import DateField from "@/components/ui/DateField";
import InlineSelect from "@/components/ui/InlineSelect";
import { useT } from "@/lib/i18n";
import type { FinanceMethod } from "@/lib/financeEntries";
import type { SalaryDraft, SalaryDraftErrors, SalaryUnit } from "@/lib/salary";
import { pkToday } from "@/lib/pkDate";

const UNITS: SalaryUnit[] = ["month", "week", "day", "year"];
const METHODS: FinanceMethod[] = ["cash", "bank", "easypaisa", "jazzcash"];

function Field({
  label,
  children,
  error,
  optional,
}: {
  label: string;
  children: ReactNode;
  error?: string;
  optional?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>{label}</span>
        {optional && <span className="text-9" style={{ color: "var(--text-tertiary)" }}>{optional}</span>}
      </div>
      {children}
      {error && <p className="text-10" style={{ color: "var(--error)" }}>{error}</p>}
    </div>
  );
}

/**
 * The salary fields shared by Add Employee and the employee's own salary screen.
 * The amount is the amount of ONE payment; the cadence says when it is paid.
 */
export default function SalaryFields({
  value,
  onChange,
  errors = {},
  disabled = false,
  showExpenseToggle = true,
}: {
  value: SalaryDraft;
  onChange: (next: SalaryDraft) => void;
  errors?: SalaryDraftErrors;
  disabled?: boolean;
  showExpenseToggle?: boolean;
}) {
  const t = useT();
  const update = <K extends keyof SalaryDraft>(key: K, next: SalaryDraft[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <div className="flex flex-col gap-3" data-testid="salary-fields">
      <Field label={t("salary.amount")} error={errors.amount && t(errors.amount)}>
        <div className="ds-field">
          <span className="text-13 font-semibold me-2 shrink-0" style={{ color: "var(--text-secondary)" }}>Rs</span>
          <input
            value={value.amount}
            onChange={(event) => update("amount", event.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            placeholder="0.00"
            disabled={disabled}
            aria-label={t("salary.amount")}
            data-testid="salary-amount"
            className="flex-1 min-w-0 h-full bg-transparent outline-none text-13 tabular-nums"
            style={{ color: "var(--text-primary)" }}
          />
        </div>
      </Field>

      <Field label={t("salary.payFrequency")}>
        <InlineSelect
          value={value.payUnit}
          options={UNITS.map((unit) => ({ value: unit, label: t(`salary.unit.${unit}`) }))}
          onChange={(next) => update("payUnit", next as SalaryUnit)}
          label={t("salary.payFrequency")}
          testId="salary-pay-unit"
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label={t("salary.every")}>
          <div className="ds-field">
            <input
              value={value.payEvery}
              onChange={(event) => update("payEvery", event.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
              onBlur={() => update("payEvery", String(Math.min(60, Math.max(1, Number(value.payEvery) || 1))))}
              inputMode="numeric"
              disabled={disabled}
              aria-label={t("salary.every")}
              data-testid="salary-every"
              className="flex-1 min-w-0 h-full bg-transparent outline-none text-13 tabular-nums text-center"
              style={{ color: "var(--text-primary)" }}
            />
          </div>
        </Field>
        {value.payUnit === "month" ? (
          <Field label={t("salary.payDay")} error={errors.payDay && t(errors.payDay)}>
            <div className="ds-field">
              <input
                value={value.payDay}
                onChange={(event) => update("payDay", event.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
                onBlur={() => update("payDay", String(Math.min(31, Math.max(1, Number(value.payDay) || 1))))}
                inputMode="numeric"
                disabled={disabled}
                aria-label={t("salary.payDay")}
                data-testid="salary-pay-day"
                className="flex-1 min-w-0 h-full bg-transparent outline-none text-13 tabular-nums text-center"
                style={{ color: "var(--text-primary)" }}
              />
            </div>
          </Field>
        ) : (
          <Field label={t("salary.firstPayment")}>
            <DateField
              value={value.startsOn}
              onChange={(next) => update("startsOn", next)}
              ariaLabel={t("salary.firstPayment")}
              testId="salary-start"
            />
          </Field>
        )}
      </div>

      {value.payUnit === "month" && (
        <Field label={t("salary.startsOn")} error={errors.startsOn && t(errors.startsOn)}>
          <DateField
            value={value.startsOn}
            onChange={(next) => update("startsOn", next)}
            ariaLabel={t("salary.startsOn")}
            testId="salary-start-month"
          />
        </Field>
      )}

      <Field label={t("salary.ends")}>
        <div className="flex gap-2 flex-wrap">
          {(["never", "date", "payments"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => update("endMode", mode)}
              aria-pressed={value.endMode === mode}
              data-testid={`salary-end-${mode}`}
              className="h-9 px-3 rounded-full text-11 font-semibold"
              style={value.endMode === mode
                ? { background: "var(--brand)", color: "#0a0a0a" }
                : { background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
            >
              {t(`salary.end.${mode}`)}
            </button>
          ))}
        </div>
      </Field>

      {value.endMode === "date" && (
        <Field label={t("salary.endDate")} error={errors.endsOn && t(errors.endsOn)}>
          <DateField
            value={value.endsOn}
            min={value.startsOn || pkToday()}
            onChange={(next) => update("endsOn", next)}
            ariaLabel={t("salary.endDate")}
            testId="salary-end-date"
          />
        </Field>
      )}

      {value.endMode === "payments" && (
        <Field label={t("salary.totalPayments")} error={errors.totalPayments && t(errors.totalPayments)}>
          <div className="ds-field">
            <input
              value={value.totalPayments}
              onChange={(event) => update("totalPayments", event.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
              inputMode="numeric"
              placeholder="12"
              disabled={disabled}
              aria-label={t("salary.totalPayments")}
              data-testid="salary-total-payments"
              className="flex-1 min-w-0 h-full bg-transparent outline-none text-13 tabular-nums"
              style={{ color: "var(--text-primary)" }}
            />
          </div>
        </Field>
      )}

      <Field label={t("salary.method")}>
        <InlineSelect
          value={value.method}
          options={METHODS.map((method) => ({ value: method, label: t(`finance.method.${method}`) }))}
          onChange={(next) => update("method", next as FinanceMethod)}
          label={t("salary.method")}
          testId="salary-method"
        />
      </Field>

      {showExpenseToggle && (
        <label className="flex items-start gap-3 rounded-[var(--radius-tile)] p-3 cursor-pointer" style={{ background: "var(--tone-sunken)" }}>
          <input
            type="checkbox"
            checked={value.addToExpenses}
            onChange={(event) => update("addToExpenses", event.target.checked)}
            disabled={disabled}
            className="mt-0.5 size-4 accent-[var(--brand)]"
            data-testid="salary-add-expense"
          />
          <span className="min-w-0">
            <span className="text-12 font-semibold block">{t("salary.addToExpenses")}</span>
            <span className="text-10 mt-0.5 block" style={{ color: "var(--text-secondary)" }}>
              {t("salary.addToExpensesHint")}
            </span>
          </span>
        </label>
      )}
    </div>
  );
}
