import { useState, useEffect } from "react";
import { X, ChevronDown } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { ReminderConfig, ReminderRepeat, ReminderEnds, ReminderAnchor } from "@/types";

const DEFAULT_CONFIG: ReminderConfig = {
  id: "new-" + Date.now(),
  enabled: true,
  startDays: 15,
  anchor: "after_credit",
  repeat: "escalate",
  intervalN: 7,
  intervalUnit: "days",
  escalation: [
    { label: "Gentle", tone: "gentle nudge", day: 15 },
    { label: "Firmer", tone: "firmer follow-up", day: 30 },
    { label: "Final notice", tone: "final notice", day: 45 },
  ],
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
  if (config.ends === "paid") endsText = t("reminder.untilPaid", "stops automatically once the balance is paid");
  else if (config.ends === "date") endsText = t("reminder.specificDate", "On a specific date") + " — " + (config.endsDate || "");
  else endsText = t("reminder.afterCount", "After a number of reminders") + " — " + config.endsCount;

  if (config.repeat === "once") {
    return config.startDays + " " + t("reminder.days", "days") + " " + anchorText + " \u2014 " + endsText;
  } else if (config.repeat === "interval") {
    return config.startDays + " " + t("reminder.days", "days") + " " + anchorText + ", " + t("reminder.every") + " " + config.intervalN + " " + t("reminder." + config.intervalUnit, config.intervalUnit) + " \u2014 " + endsText;
  } else {
    const parts = config.escalation.map(function(s) { return s.day + " " + t("reminder.day", "day"); });
    return config.startDays + " " + t("reminder.days", "days") + " " + anchorText + " \u2014 " + parts.join(", ") + " \u2014 " + endsText;
  }
}

interface Props {
  config: ReminderConfig | null;
  onSave: (config: ReminderConfig) => void;
  onClose: () => void;
}

export default function ReminderConfigSheet({ config, onSave, onClose }: Props) {
  const t = useT();
  const [local, setLocal] = useState<ReminderConfig>(config ?? { ...DEFAULT_CONFIG, id: "new-" + Date.now() });

  // Lock background scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    setLocal(config ?? { ...DEFAULT_CONFIG });
  }, [config]);

  function update<K extends keyof ReminderConfig>(key: K, value: ReminderConfig[K]) {
    setLocal((prev) => ({ ...prev, [key]: value }));
  }

  function updateEscDay(index: number, day: number) {
    setLocal((prev) => {
      const esc = [...prev.escalation];
      esc[index] = { ...esc[index], day };
      return { ...prev, escalation: esc };
    });
  }

  const fieldStyle = {
    background: "var(--surface-2)",
    color: "var(--text-primary)",
    border: "1px solid var(--divider)",
    borderRadius: "24px",
  };

  const labelCls = "text-[11px] font-semibold uppercase tracking-wider mb-2 block";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[390px] mx-auto rounded-t-[24px] flex flex-col"
        style={{ background: "var(--surface)", maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: "var(--divider)" }} />
        </div>

        {/* Header */}
        <div className="px-5 pb-4 flex items-center justify-between">
          <p className="text-[16px] font-semibold" style={{ color: "var(--text-primary)" }}>{t("reminder.configTitle")}</p>
          <button
            onClick={onClose}
            className="size-8 rounded-full flex items-center justify-center"
            style={{ background: "var(--surface-2)" }}
          >
            <X size={16} style={{ color: "var(--text-secondary)" }} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="px-5 pb-6 flex flex-col gap-5 overflow-y-auto" style={{ flex: 1 }}>

          {/* Start reminders */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("reminder.startReminders")}</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={local.startDays}
                min={0}
                onChange={(e) => update("startDays", parseInt(e.target.value) || 0)}
                className="h-12 px-4 text-sm w-[72px] outline-none font-medium"
                style={fieldStyle}
              />
              <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{t("reminder.days")}</span>
              <div className="flex-1 relative">
                <select
                  value={local.anchor}
                  onChange={(e) => update("anchor", e.target.value as ReminderAnchor)}
                  className="w-full h-12 px-4 pe-10 text-[13px] outline-none appearance-none font-medium"
                  style={fieldStyle}
                >
              <option value="after_credit">{t("reminder.afterCreditGiven")}</option>
              <option value="before_due">{t("reminder.beforeDueDateFull")}</option>
              <option value="after_due">{t("reminder.afterDueDateFull")}</option>
              <option value="before_harvest">{t("reminder.beforeHarvestFull")}</option>
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-secondary)" }} />
              </div>
            </div>
          </div>

          {/* Repeat */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("reminder.repeat")}</p>
            <div className="relative">
              <select
                value={local.repeat}
                onChange={(e) => update("repeat", e.target.value as ReminderRepeat)}
                className="w-full h-12 px-4 pe-10 text-[13px] outline-none appearance-none font-medium"
                style={fieldStyle}
              >
                <option value="once">{t("reminder.oneTimeReminder")}</option>
                <option value="interval">{t("reminder.fixedInterval")}</option>
                <option value="escalate">{t("reminder.escalatingSeq")}</option>
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-secondary)" }} />
            </div>
          </div>

          {/* Interval fields */}
          {local.repeat === "interval" && (
            <div className="ps-4">
              <div className="flex items-center gap-2">
                <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{t("reminder.every")}</span>
                <input
                  type="number"
                  value={local.intervalN}
                  min={1}
                  onChange={(e) => update("intervalN", parseInt(e.target.value) || 1)}
                  className="h-12 px-3 text-sm w-[60px] outline-none font-medium"
                  style={fieldStyle}
                />
                <div className="relative">
                  <select
                    value={local.intervalUnit}
                    onChange={(e) => update("intervalUnit", e.target.value as "days" | "weeks")}
                    className="h-12 px-3 pe-8 text-[13px] outline-none appearance-none font-medium"
                    style={fieldStyle}
                  >
                    <option value="days">{t("reminder.days")}</option>
                    <option value="weeks">{t("reminder.weeks")}</option>
                  </select>
                  <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-secondary)" }} />
                </div>
              </div>
            </div>
          )}

          {/* Escalation fields */}
          {local.repeat === "escalate" && (
            <div className="ps-4 flex flex-col gap-3">
              {local.escalation.map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-[13px] w-[96px] shrink-0 font-medium" style={{ color: "var(--text-secondary)" }}>{step.label === "Gentle" ? t("reminder.gentle") : step.label === "Firmer" ? t("reminder.firmer") : t("reminder.finalNotice")}</span>
                  <span className="text-[12px]" style={{ color: "var(--text-muted, var(--text-secondary))" }}>{t("reminder.day")}</span>
                  <input
                    type="number"
                    value={step.day}
                    min={0}
                    onChange={(e) => updateEscDay(i, parseInt(e.target.value) || 0)}
                    className="h-10 px-3 text-[13px] w-[64px] outline-none font-medium"
                    style={fieldStyle}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Ends */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("reminder.ends")}</p>
            <div className="relative">
              <select
                value={local.ends}
                onChange={(e) => update("ends", e.target.value as ReminderEnds)}
                className="w-full h-12 px-4 pe-10 text-[13px] outline-none appearance-none font-medium"
                style={fieldStyle}
              >
                <option value="paid">{t("reminder.untilPaid")}</option>
                <option value="date">{t("reminder.specificDate")}</option>
                <option value="count">{t("reminder.afterCount")}</option>
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-secondary)" }} />
            </div>
          </div>

          {/* Ends date */}
          {local.ends === "date" && (
            <div>
              <input
                type="date"
                value={local.endsDate ?? ""}
                onChange={(e) => update("endsDate", e.target.value || null)}
                className="w-full h-12 px-4 text-sm outline-none font-medium"
                style={fieldStyle}
              />
            </div>
          )}

          {/* Ends count */}
          {local.ends === "count" && (
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={local.endsCount}
                min={1}
                onChange={(e) => update("endsCount", parseInt(e.target.value) || 1)}
                className="h-12 px-4 text-sm w-[80px] outline-none font-medium"
                style={fieldStyle}
              />
              <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{t("reminder.reminders")}</span>
            </div>
          )}

          {/* Summary */}
          <div
            className="rounded-[14px] p-4 text-[13px] leading-relaxed"
            style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--brand, #639922)", borderLeft: "3px solid var(--brand, #639922)" }}
          >
            {buildSummary(local, t)}
          </div>

          {/* Save button */}
          <button
            onClick={() => onSave({ ...local, id: local.id || "new-" + Date.now(), enabled: true })}
            className="w-full h-12 rounded-full text-[14px] font-bold transition-opacity active:opacity-80"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            {t("reminder.saveSchedule")}
          </button>
        </div>
      </div>
    </div>
  );
}
