import { useState, useEffect } from "react";
import { useDelayedDismiss } from "@/hooks/usePresence";

/** Matches --dur-3, the sheet duration token. */
const SHEET_MS = 280;
import { X, Users } from "lucide-react";
import SelectorField from "./SelectorField";
import { useT } from "@/lib/i18n";
import CustomerSelector from "./CustomerSelector";
import type { ReminderConfig, ReminderRepeat, ReminderEnds, ReminderAnchor } from "@/types";
import { DEFAULT_ESCALATION, escalationIsOrdered } from "@/lib/reminderEngine";

const DEFAULT_CONFIG: ReminderConfig = {
  id: "new-group-" + Date.now(),
  enabled: true,
  startDays: 3,
  anchor: "before_due",
  repeat: "interval",
  intervalN: 2,
  intervalUnit: "days",
  // The escalating sequence ships with the form: choosing "Escalating sequence"
  // with an empty list used to render nothing at all, and the engine then collapsed
  // the reminder to a single stage — the escalation silently did not happen.
  escalation: DEFAULT_ESCALATION.map((s) => ({ ...s })),
  ends: "paid",
  endsDate: null,
  endsCount: 5,
};

const ANCHOR_KEYS: Record<ReminderAnchor, string> = {
  after_credit: "reminder.afterCreditGiven",
  after_due: "reminder.afterDueDateFull",
  before_due: "reminder.beforeDueDateFull",
  before_harvest: "reminder.beforeHarvestFull",
};

function buildSummary(config: ReminderConfig, t: (key: string, fallback?: string) => string): string {
  const anchorText = t(ANCHOR_KEYS[config.anchor]);
  let endsText = "";
  if (config.ends === "paid") endsText = t("reminder.untilPaid", "stops when paid");
  else if (config.ends === "date") endsText = t("reminder.specificDate") + " — " + (config.endsDate || "");
  else endsText = t("reminder.afterCount") + " — " + config.endsCount;

  if (config.repeat === "once") {
    return config.startDays + " " + t("reminder.days") + " " + anchorText + " — " + endsText;
  } else if (config.repeat === "interval") {
    return config.startDays + " " + t("reminder.days") + " " + anchorText + ", " + t("reminder.every") + " " + config.intervalN + " " + t("reminder." + config.intervalUnit, config.intervalUnit) + " — " + endsText;
  } else {
    const steps = config.escalation.length > 0 ? config.escalation : DEFAULT_ESCALATION;
    const parts = steps.map(s => s.day + " " + t("reminder.day", "day"));
    return config.startDays + " " + t("reminder.days") + " " + anchorText + " — " + parts.join(", ") + " — " + endsText;
  }
}

interface Props {
  groupName?: string;
  config?: ReminderConfig | null;
  selectedCustomerIds?: string[];
  onSave: (config: ReminderConfig, customerIds: string[], groupName: string) => void;
  onClose: () => void;
}

export default function GroupReminderSheet({ groupName: initGroupName, config: initConfig, selectedCustomerIds: initSelected, onSave, onClose }: Props) {
  const t = useT();
  const [step, setStep] = useState<"customers" | "config">("customers");
  const [groupName, setGroupName] = useState(initGroupName || "");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initSelected || []));
  const [config, setConfig] = useState<ReminderConfig>(initConfig ?? { ...DEFAULT_CONFIG, id: "new-group-" + Date.now() });
  const { closing, dismiss } = useDelayedDismiss(onClose, SHEET_MS);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  function updateConfig<K extends keyof ReminderConfig>(key: K, value: ReminderConfig[K]) {
    setConfig(prev => ({ ...prev, [key]: value }));
  }

  /** Choosing the escalating sequence always brings its steps with it. */
  function setRepeat(repeat: ReminderRepeat) {
    setConfig(prev => ({
      ...prev,
      repeat,
      escalation:
        repeat === "escalate" && prev.escalation.length === 0
          ? DEFAULT_ESCALATION.map((s) => ({ ...s }))
          : prev.escalation,
    }));
  }

  const escalationOrdered = escalationIsOrdered(config.escalation);
  const escalationInvalid = config.repeat === "escalate" && !escalationOrdered;

  const fieldStyle = {
    background: "var(--surface-2)",
    color: "var(--text-primary)",
    border: "1px solid var(--divider)",
    borderRadius: "24px",
  };
  const labelCls = "ds-section-label mb-2 block";

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end ds-backdrop ${
        closing ? "ds-anim-backdrop-out ds-anim-leaving" : "ds-anim-backdrop-in"
      }`}
      onClick={closing ? undefined : dismiss}
    >
      <div
        className={`w-full max-w-[390px] mx-auto rounded-t-[24px] flex flex-col ${
          closing ? "ds-anim-sheet-out" : "ds-anim-sheet-in"
        }`}
        style={{ background: "var(--surface)", maxHeight: "92vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: "var(--divider)" }} />
        </div>

        <div className="px-5 pb-3 flex items-center justify-between">
          <p className="text-16 font-semibold" style={{ color: "var(--text-primary)" }}>
            {t("inline.create_group_reminder")}
          </p>
          <button onClick={dismiss} className="size-8 rounded-full flex items-center justify-center ds-pressable" style={{ background: "var(--surface-2)" }}>
            <X size={16} style={{ color: "var(--text-secondary)" }} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-5 pb-3 flex gap-2">
          <button
            onClick={() => setStep("customers")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-11 font-semibold"
            style={{
              background: step === "customers" ? "var(--brand)" : "var(--surface-2)",
              color: step === "customers" ? "#0a0a0a" : "var(--text-secondary)",
            }}
          >
            <Users size={12} />
            {t("inline.select_customers")}
          </button>
          <button
            onClick={() => setStep("config")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-11 font-semibold"
            style={{
              background: step === "config" ? "var(--brand)" : "var(--surface-2)",
              color: step === "config" ? "#0a0a0a" : "var(--text-secondary)",
            }}
          >
            {t("inline.configure")}
          </button>
        </div>

        <div className="px-5 pb-6 flex flex-col gap-4 overflow-y-auto" style={{ flex: 1 }}>
          {step === "customers" ? (
            <>
              {/* Group name */}
              <div>
                <label className={labelCls} style={{ color: "var(--text-secondary)" }}>
                  {t("inline.group_name")}
                </label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder={t("inline.e_g_credit_payment_follow_up")}
                  className="w-full h-12 px-4 text-13 outline-none font-medium"
                  style={fieldStyle}
                />
              </div>

              {/* Customer selector */}
              <CustomerSelector
                selectedIds={selectedIds}
                onChange={setSelectedIds}
              />

              {selectedIds.size > 0 && (
                <button
                  onClick={() => setStep("config")}
                  className="w-full h-12 rounded-full text-14 font-bold"
                  style={{ background: "var(--brand)", color: "#0a0a0a" }}
                >
                  {t("common.nextWithCount", { count: selectedIds.size })}
                </button>
              )}
            </>
          ) : (
            <>
              {/* Back to customers */}
              <button
                onClick={() => setStep("customers")}
                className="text-12 font-semibold flex items-center gap-1"
                style={{ color: "var(--brand-dark, #65a30d)" }}
              >
                ← {t("inline.back_to_customers")}
              </button>

              {/* Config form (same fields as ReminderConfigSheet) */}
              <div>
                <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("reminder.startReminders")}</p>
                <div className="flex items-center gap-2">
                  <input type="number" value={config.startDays} min={0}
                    onChange={(e) => updateConfig("startDays", parseInt(e.target.value) || 0)}
                    className="h-12 px-4 text-sm w-[72px] outline-none font-medium" style={fieldStyle} />
                  <span className="text-13" style={{ color: "var(--text-secondary)" }}>{t("reminder.days")}</span>
                  <div className="flex-1">
                    <SelectorField
                      value={config.anchor}
                      options={[
                        { value: "after_credit", label: t("reminder.afterCreditGiven") },
                        { value: "before_due", label: t("reminder.beforeDueDateFull") },
                        { value: "after_due", label: t("reminder.afterDueDateFull") },
                        { value: "before_harvest", label: t("reminder.beforeHarvestFull") },
                      ]}
                      placeholder={t("reminder.afterCreditGiven")}
                      title={t("reminder.startReminders")}
                      onChange={(v) => updateConfig("anchor", v as ReminderAnchor)}
                      showTile={false}
                    />
                  </div>
                </div>
              </div>

              <div>
                <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("reminder.repeat")}</p>
                <SelectorField
                  value={config.repeat}
                  options={[
                    { value: "once", label: t("reminder.oneTimeReminder") },
                    { value: "interval", label: t("reminder.fixedInterval") },
                    { value: "escalate", label: t("reminder.escalatingSeq") },
                  ]}
                  placeholder={t("reminder.oneTimeReminder")}
                  title={t("reminder.repeat")}
                  onChange={(v) => setRepeat(v as ReminderRepeat)}
                  showTile={false}
                />
              </div>

              {config.repeat === "interval" && (
                <div className="ps-4">
                  <div className="flex items-center gap-2">
                    <span className="text-13" style={{ color: "var(--text-secondary)" }}>{t("reminder.every")}</span>
                    <input type="number" value={config.intervalN} min={1}
                      onChange={(e) => updateConfig("intervalN", parseInt(e.target.value) || 1)}
                      className="h-12 px-3 text-sm w-[60px] outline-none font-medium" style={fieldStyle} />
                    <div className="w-[116px]">
                      <SelectorField
                        value={config.intervalUnit}
                        options={[
                          { value: "days", label: t("reminder.days") },
                          { value: "weeks", label: t("reminder.weeks") },
                        ]}
                        placeholder={t("reminder.days")}
                        title={t("reminder.repeat")}
                        onChange={(v) => updateConfig("intervalUnit", v as "days" | "weeks")}
                        showTile={false}
                      />
                    </div>
                  </div>
                </div>
              )}

              {config.repeat === "escalate" && (
                <div className="ps-4 flex flex-col gap-3">
                  {config.escalation.map((step, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-13 w-[96px] shrink-0 font-medium" style={{ color: "var(--text-secondary)" }}>
                        {step.label === "Gentle" ? t("reminder.gentle") : step.label === "Firmer" ? t("reminder.firmer") : t("reminder.finalNotice")}
                      </span>
                      <span className="text-12" style={{ color: "var(--text-secondary)" }}>{t("reminder.day")}</span>
                      <input type="number" value={step.day} min={1}
                        onChange={(e) => {
                          const esc = [...config.escalation];
                          esc[i] = { ...esc[i], day: parseInt(e.target.value) || 0 };
                          updateConfig("escalation", esc);
                        }}
                        className="h-10 px-3 text-13 w-[64px] outline-none font-medium" style={fieldStyle} />
                    </div>
                  ))}
                  {escalationInvalid && (
                    <p className="text-12 leading-snug" style={{ color: "var(--error)" }}>
                      {t("reminder.escalationOrder")}
                    </p>
                  )}
                </div>
              )}

              <div>
                <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("reminder.ends")}</p>
                <SelectorField
                  value={config.ends}
                  options={[
                    { value: "paid", label: t("reminder.untilPaid") },
                    { value: "date", label: t("reminder.specificDate") },
                    { value: "count", label: t("reminder.afterCount") },
                  ]}
                  placeholder={t("reminder.untilPaid")}
                  title={t("reminder.ends")}
                  onChange={(v) => updateConfig("ends", v as ReminderEnds)}
                  showTile={false}
                />
              </div>

              {config.ends === "date" && (
                <input type="date" value={config.endsDate ?? ""}
                  onChange={(e) => updateConfig("endsDate", e.target.value || null)}
                  className="w-full outline-none font-medium" />
              )}

              {config.ends === "count" && (
                <div className="flex items-center gap-2">
                  <input type="number" value={config.endsCount} min={1}
                    onChange={(e) => updateConfig("endsCount", parseInt(e.target.value) || 1)}
                    className="h-12 px-4 text-sm w-[80px] outline-none font-medium" style={fieldStyle} />
                  <span className="text-13" style={{ color: "var(--text-secondary)" }}>{t("reminder.reminders")}</span>
                </div>
              )}

              {/* Summary */}
              <div className="rounded-[var(--radius-card)] p-4 text-13 leading-relaxed"
                style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--brand, #639922)", borderLeft: "3px solid var(--brand, #639922)" }}>
                {buildSummary(config, t)}
              </div>

              {/* Group summary */}
              <div className="rounded-[var(--radius-card)] p-3 text-12" style={{ background: "var(--tone-card)" }}>
                <p style={{ color: "var(--text-secondary)" }}>
                  {t("groupReminderSheet.groupLabel", { name: groupName })}
                </p>
                <p className="font-semibold mt-1" style={{ color: "var(--text-primary)" }}>
                  {selectedIds.size} {t("inline.customers_selected")}
                </p>
              </div>

              <button
                onClick={() => onSave({ ...config, id: config.id || "new-group-" + Date.now(), enabled: true }, Array.from(selectedIds), groupName)}
                disabled={!groupName.trim() || selectedIds.size === 0 || escalationInvalid}
                className="w-full h-12 rounded-full text-14 font-bold transition-opacity active:opacity-80 disabled:opacity-50"
                style={{ background: "var(--brand)", color: "#0a0a0a" }}
              >
                {t("inline.save_group_reminder")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
