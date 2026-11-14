import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  PauseCircle,
  ReceiptText,
  Wallet,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import Sheet from "@/components/ui/Sheet";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { SkeletonList } from "@/components/ui/Skeleton";
import SalaryFields from "@/components/admin/SalaryFields";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useAuthStore } from "@/stores/authStore";
import { useShopStore } from "@/stores/shopStore";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { formatCurrency } from "@/lib/formatters";
import { METHOD_KEY, REPEAT_KEY, stopFinanceRecurrence } from "@/lib/financeEntries";
import {
  saveEmployeeSalary,
  useEmployeeSalary,
  validateSalaryDraft,
  salaryHasErrors,
  type SalaryDraft,
  type EmployeeSalary,
} from "@/lib/salary";
import { pkToday } from "@/lib/pkDate";

function draftFromSalary(salary: EmployeeSalary): SalaryDraft {
  return {
    amount: String(salary.amount),
    payEvery: String(salary.payEvery),
    payUnit: salary.payUnit,
    payDay: String(salary.payDay ?? 1),
    startsOn: salary.startsOn,
    endMode: salary.totalPayments ? "payments" : salary.endsOn ? "date" : "never",
    endsOn: salary.endsOn ?? "",
    totalPayments: salary.totalPayments ? String(salary.totalPayments) : "",
    method: (METHOD_KEY[salary.method as keyof typeof METHOD_KEY] ? salary.method : "cash") as SalaryDraft["method"],
    addToExpenses: salary.addToExpenses,
  };
}

export default function EmployeeSalaryPage() {
  const t = useT();
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();
  const base = useShellBase();
  const language = useThemeStore((s) => s.language);
  const { addToast } = useUIStore();
  const role = useAuthStore((s) => s.user?.membershipRole);
  const activeBranchId = useShopStore((s) => s.activeBranchId);
  const employees = useEmployeesStore((s) => s.employees);
  const employeesReady = useEmployeesStore((s) => s.ready);
  const loadEmployees = useEmployeesStore((s) => s.load);
  const { salary, failed, loading, retry } = useEmployeeSalary(employeeId);
  const employee = employees.find((row) => row.id === employeeId);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SalaryDraft | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopping, setStopping] = useState(false);

  const isOwner = role === "owner";

  useEffect(() => {
    if (!employeesReady) void loadEmployees();
  }, [employeesReady, loadEmployees]);

  useEffect(() => {
    if (!salary) return;
    setDraft(draftFromSalary(salary));
  }, [salary]);

  const shortDate = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(language === "ur" ? "ur-PK" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });

  const methodLabel = (method: string) =>
    METHOD_KEY[method as keyof typeof METHOD_KEY] ? t(METHOD_KEY[method as keyof typeof METHOD_KEY]) : method;

  const cadenceLabel = (value: Pick<EmployeeSalary, "payEvery" | "payUnit">) =>
    value.payEvery <= 1
      ? t(REPEAT_KEY[value.payUnit])
      : t("finance.recurring.cadence", {
          count: String(value.payEvery),
          unit: t(REPEAT_KEY[value.payUnit]),
        });

  const paidTotal = useMemo(
    () => (salary?.history ?? []).reduce((sum, row) => sum + row.amount, 0),
    [salary],
  );

  if (role && !isOwner) {
    return (
      <div className="flex flex-col min-h-full" style={{ background: "var(--background)", color: "var(--text-primary)" }}>
        <StatusBar />
        <NavHeader title={t("employeeSalary.title")} backTo={`${base}/employees/${employeeId ?? ""}`} />
        <p className="px-4 pt-4 text-12" style={{ color: "var(--text-secondary)" }}>{t("salary.ownerOnly")}</p>
      </div>
    );
  }

  if (!employeesReady && !employee) {
    return (
      <div className="flex flex-col min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("employeeSalary.title")} backTo={`${base}/employees`} />
        <SkeletonList rows={5} />
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="flex flex-col min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("employeeSalary.title")} backTo={`${base}/employees`} />
        <p className="px-4 pt-4 text-12" style={{ color: "var(--text-secondary)" }}>{t("employeeSalary.notFound")}</p>
      </div>
    );
  }

  async function save() {
    if (!draft || saving) return;
    const errors = validateSalaryDraft(draft);
    setTouched(true);
    if (salaryHasErrors(errors)) return;
    setSaving(true);
    setError("");
    try {
      await saveEmployeeSalary({
        employeeId: employee!.id,
        branchId: activeBranchId,
        amount: Number(draft.amount),
        payEvery: Math.max(1, Number(draft.payEvery) || 1),
        payUnit: draft.payUnit,
        payDay: draft.payUnit === "month" ? Number(draft.payDay) || 1 : null,
        startsOn: draft.startsOn || pkToday(),
        endsOn: draft.endMode === "date" ? draft.endsOn : null,
        totalPayments: draft.endMode === "payments" ? Number(draft.totalPayments) : null,
        method: draft.method,
        addToExpenses: draft.addToExpenses,
      });
      addToast(t("employeeSalary.saved"), "success");
      setEditing(false);
      retry();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("employeeSalary.errSave"));
    } finally {
      setSaving(false);
    }
  }

  async function stop() {
    if (!salary?.recurrenceId || stopping) return;
    setStopping(true);
    try {
      await stopFinanceRecurrence(salary.recurrenceId);
      addToast(t("employeeSalary.stopped"), "success");
      setConfirmStop(false);
      retry();
    } catch (failure) {
      addToast(failure instanceof Error ? failure.message : t("employeeSalary.errSave"), "error");
    } finally {
      setStopping(false);
    }
  }

  const nextOn = salary?.nextOn;
  const headline = salary
    ? t("salary.summary", {
        amount: String(salary.amount),
        frequency: t(`salary.unit.${salary.payUnit}`),
      })
    : t("employeeSalary.noSalary");

  return (
    <div
      className="flex flex-col w-full min-h-full pb-10"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="employee-salary-page"
    >
      <StatusBar />
      <NavHeader title={t("employeeSalary.title")} backTo={`${base}/employees/${employee.id}`} />

      <div className="px-4 pt-2 pb-4">
        <div className="flex items-start gap-3">
          <span className="size-12 rounded-full grid place-items-center shrink-0 text-14 font-bold" style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}>
            {employee.name.split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-16 font-bold truncate">{employee.name}</p>
            <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>{employee.roleName ?? t("empDetail.noRole")}</p>
          </div>
          {salary && (
            <span
              className="text-9 font-bold px-2 py-0.5 rounded-full shrink-0"
              style={salary.isActive
                ? { background: "var(--brand-light)", color: "var(--brand-dark)" }
                : { background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
            >
              {salary.isActive ? t("salary.active") : t("salary.paused")}
            </span>
          )}
        </div>
        <p className="text-11 mt-3" style={{ color: "var(--text-secondary)" }}>{t("employeeSalary.subtitle")}</p>
      </div>

      {failed ? (
        <div className="px-4 flex items-start gap-3">
          <p className="text-11" style={{ color: "var(--error)" }}>{t("salary.errSave")}</p>
          <button type="button" onClick={retry} className="text-11 font-bold" style={{ color: "var(--brand-dark)" }}>{t("common.retry")}</button>
        </div>
      ) : loading ? (
        <div className="px-4"><SkeletonList rows={3} /></div>
      ) : !salary ? (
        <div className="px-4 flex flex-col gap-3" data-testid="employee-salary-empty">
          <div className="rounded-[var(--radius-card)] p-4" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
            <span className="size-10 rounded-[var(--radius-tile)] grid place-items-center" style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}>
              <Wallet size={18} />
            </span>
            <p className="text-13 font-bold mt-2">{t("employeeSalary.noSalary")}</p>
            <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>{t("salary.optionalHint")}</p>
          </div>
          <Button fullWidth size="lg" variant="cta" onClick={() => { setDraft(draftFromSalary({
            employeeId: employee.id, employeeName: employee.name, compensationId: "", amount: 0,
            payEvery: 1, payUnit: "month", payDay: 1, startsOn: pkToday(), endsOn: null,
            totalPayments: null, method: "cash", addToExpenses: true, isActive: false, nextOn: null,
            recurrenceId: null, history: [],
          })); setEditing(true); }} testId="salary-add">
            {t("employeeSalary.addSalary")}
          </Button>
        </div>
      ) : (
        <>
          <div className="px-4">
            <div className="rounded-[var(--radius-card)] p-4" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
              <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("salary.amount")}</p>
              <p className="text-28 font-bold tabular-nums mt-1" style={{ color: "var(--brand-dark)" }}>{formatCurrency(salary.amount)}</p>
              <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>
                {cadenceLabel(salary)}
                {salary.payUnit === "month" && salary.payDay ? ` · ${t("salary.payDay")} ${salary.payDay}` : ""}
              </p>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="rounded-[var(--radius-tile)] p-2.5" style={{ background: "var(--tone-sunken)" }}>
                  <p className="text-9" style={{ color: "var(--text-secondary)" }}>{t("employeeSalary.totalPaid")}</p>
                  <p className="text-14 font-bold tabular-nums mt-0.5">{formatCurrency(paidTotal)}</p>
                </div>
                <div className="rounded-[var(--radius-tile)] p-2.5" style={{ background: "var(--tone-sunken)" }}>
                  <p className="text-9" style={{ color: "var(--text-secondary)" }}>{t("employeeSalary.payments")}</p>
                  <p className="text-14 font-bold tabular-nums mt-0.5">{salary.history.length}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-1.5 text-11">
                <Row icon={<CalendarDays size={13} />} label={t("salary.startsOn")} value={shortDate(salary.startsOn)} />
                {nextOn && <Row icon={<ChevronRight size={13} />} label={t("salary.nextLabel")} value={shortDate(nextOn)} />}
                <Row icon={<Wallet size={13} />} label={t("salary.method")} value={methodLabel(salary.method)} />
                <Row
                  icon={<CircleDollarSign size={13} />}
                  label={t("salary.addToExpenses")}
                  value={salary.addToExpenses ? t("salary.addToLedger") : t("salary.notInLedger")}
                />
              </div>
              <div className="flex gap-2 mt-4">
                <Button variant="outline" className="flex-1" onClick={() => setEditing(true)} testId="salary-edit">
                  {t("employeeSalary.edit")}
                </Button>
                {salary.isActive && salary.recurrenceId && (
                  <Button variant="outline" className="flex-1" onClick={() => setConfirmStop(true)} testId="salary-stop">
                    {t("employeeSalary.stop")}
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="px-4 pt-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-13 font-bold">{t("employeeSalary.history")}</p>
              <span className="text-10" style={{ color: "var(--text-tertiary)" }}>{t("employeeSalary.payments")}</span>
            </div>
            {salary.history.length === 0 ? (
              <div className="rounded-[var(--radius-card)] p-4 mt-2" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
                <ReceiptText size={20} style={{ color: "var(--text-tertiary)" }} />
                <p className="text-11 mt-2" style={{ color: "var(--text-secondary)" }}>{t("employeeSalary.noHistory")}</p>
              </div>
            ) : (
              <div className="rounded-[var(--radius-card)] mt-2 overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
                {salary.history.map((payment, index) => (
                  <div
                    key={payment.id}
                    className="flex items-center gap-3 px-3.5 py-3"
                    style={{ borderTop: index === 0 ? "none" : "1px solid var(--divider)" }}
                  >
                    <span className="size-8 rounded-full grid place-items-center shrink-0" style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}>
                      <CircleDollarSign size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-12 font-semibold">{shortDate(payment.occurredOn)}</p>
                      <p className="text-10 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                        {methodLabel(payment.method)}{payment.note ? ` · ${payment.note}` : ""}
                      </p>
                    </div>
                    <p className="text-12 font-bold tabular-nums shrink-0">{formatCurrency(payment.amount)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {salary.addToExpenses && (
            <button
              type="button"
              onClick={() => navigate(`${base}/settings/hub/finance/money`)}
              className="mx-4 mt-4 min-h-11 rounded-[var(--radius-tile)] px-3 flex items-center gap-2 text-start"
              style={{ background: "var(--tone-sunken)" }}
            >
              <ReceiptText size={15} style={{ color: "var(--brand-dark)" }} />
              <span className="text-11 font-semibold flex-1">{t("employeeSalary.viewMoney")}</span>
              <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />
            </button>
          )}
        </>
      )}

      <Sheet open={editing} title={t(salary ? "employeeSalary.edit" : "employeeSalary.addSalary")} onClose={() => setEditing(false)}>
        <div className="px-4 pb-4">
          {draft && (
            <SalaryFields
              value={draft}
              onChange={setDraft}
              errors={touched ? validateSalaryDraft(draft) : {}}
            />
          )}
          {error && <p className="text-11 mt-2" style={{ color: "var(--error)" }}>{error}</p>}
          <div className="flex gap-2 mt-4">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="flex-1 h-11 rounded-full text-12 font-semibold"
              style={{ background: "var(--tone-sunken)", color: "var(--text-primary)" }}
            >
              {t("common.cancel")}
            </button>
            <Button className="flex-1" variant="cta" onClick={() => void save()} loading={saving} testId="salary-save">
              {t("salary.save")}
            </Button>
          </div>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmStop}
        title={t("employeeSalary.stopTitle")}
        message={t("employeeSalary.stopHint")}
        confirmLabel={t("employeeSalary.stop")}
        destructive
        loading={stopping}
        onConfirm={() => void stop()}
        onCancel={() => setConfirmStop(false)}
      />
    </div>
  );
}

function Row({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0" style={{ color: "var(--text-tertiary)" }}>{icon}</span>
      <span className="flex-1 min-w-0 truncate" style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span className="font-semibold text-end shrink-0 max-w-[50%] truncate">{value}</span>
    </div>
  );
}
