import { useState, useEffect } from "react";
import { useDelayedDismiss } from "@/hooks/usePresence";

/** Matches --dur-3, the sheet duration token. */
const SHEET_MS = 280;
import { X } from "lucide-react";
import SelectorField from "./SelectorField";
import { useT } from "@/lib/i18n";
import type { ReminderConfig, ReminderRepeat, ReminderEnds, ReminderAnchor } from "@/types";
import { DEFAULT_ESCALATION, escalationIsOrdered } from "@/lib/reminderEngine";

const DEFAULT_CONFIG: ReminderConfig = {
  id: "new-" + Date.now(),
  enabled: true,
  startDays: 15,
  anchor: "after_credit",
  repeat: "escalate",
  intervalN: 7,
  intervalUnit: "days",
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
  if (config.ends === "paid") endsText = t("reminder.untilPaid", "stops automatically once the balance is paid");
  else if (config.ends === "date") endsText = t("reminder.specificDate", "On a specific date") + " — " + (config.endsDate || "");
  else endsText = t("reminder.afterCount", "After a number of reminders") + " — " + config.endsCount;

  if (config.repeat === "once") {
    return config.startDays + " " + t("reminder.days", "days") + " " + anchorText + " \u2014 " + endsText;
  } else if (config.repeat === "interval") {
    return config.startDays + " " + t("reminder.days", "days") + " " + anchorText + ", " + t("reminder.every") + " " + config.intervalN + " " + t("reminder." + config.intervalUnit, config.intervalUnit) + " \u2014 " + endsText;
  } else {
    const steps = config.escalation.length > 0 ? config.escalation : DEFAULT_ESCALATION;
    const parts = steps.map(function(s) { return s.day + " " + t("reminder.day", "day"); });
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
  const { closing, dismiss } = useDelayedDismiss(onClose, SHEET_MS);

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

  /** Choosing the escalating sequence always brings its steps with it. */
  function setRepeat(repeat: ReminderRepeat) {
    setLocal((prev) => ({
      ...prev,
      repeat,
      escalation:
        repeat === "escalate" && prev.escalation.length === 0
          ? DEFAULT_ESCALATION.map((s) => ({ ...s }))
          : prev.escalation,
    }));
  }

  const escalationInvalid = local.repeat === "escalate" && !escalationIsOrdered(local.escalation);

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
        style={{ background: "var(--tone-sheet)", maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: "var(--divider)" }} />
        </div>

        {/* Header */}
        <div className="px-5 pb-4 flex items-center justify-between">
          <p className="text-16 font-semibold" style={{ color: "var(--text-primary)" }}>{t("reminder.configTitle")}</p>
          <button
            onClick={onClose}
            className="size-8 rounded-full flex items-center justify-center"
            style={{ background: "var(--sheet-chip)" }}
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
              <span className="text-13" style={{ color: "var(--text-secondary)" }}>{t("reminder.days")}</span>
              <div className="flex-1">
                <SelectorField
                  value={local.anchor}
                  options={[
                    { value: "after_credit", label: t("reminder.afterCreditGiven") },
                    { value: "before_due", label: t("reminder.beforeDueDateFull") },
                    { value: "after_due", label: t("reminder.afterDueDateFull") },
                    { value: "before_harvest", label: t("reminder.beforeHarvestFull") },
                  ]}
                  placeholder={t("reminder.afterCreditGiven")}
                  title={t("reminder.startReminders")}
                  onChange={(v) => update("anchor", v as ReminderAnchor)}
                  showTile={false}
                />
              </div>
            </div>
          </div>

          {/* Repeat */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("reminder.repeat")}</p>
            <SelectorField
              value={local.repeat}
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

          {/* Interval fields */}
          {local.repeat === "interval" && (
            <div className="ps-4">
              <div className="flex items-center gap-2">
                <span className="text-13" style={{ color: "var(--text-secondary)" }}>{t("reminder.every")}</span>
                <input
                  type="number"
                  value={local.intervalN}
                  min={1}
                  onChange={(e) => update("intervalN", parseInt(e.target.value) || 1)}
                  className="h-12 px-3 text-sm w-[60px] outline-none font-medium"
                  style={fieldStyle}
                />
                <div className="w-[116px]">
                  <SelectorField
                    value={local.intervalUnit}
                    options={[
                      { value: "days", label: t("reminder.days") },
                      { value: "weeks", label: t("reminder.weeks") },
                    ]}
                    placeholder={t("reminder.days")}
                    title={t("reminder.repeat")}
                    onChange={(v) => update("intervalUnit", v as "days" | "weeks")}
                    showTile={false}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Escalation fields */}
          {local.repeat === "escalate" && (
            <div className="ps-4 flex flex-col gap-3">
              {local.escalation.map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-13 w-[96px] shrink-0 font-medium" style={{ color: "var(--text-secondary)" }}>{step.label === "Gentle" ? t("reminder.gentle") : step.label === "Firmer" ? t("reminder.firmer") : t("reminder.finalNotice")}</span>
                  <span className="text-12" style={{ color: "var(--text-muted, var(--text-secondary))" }}>{t("reminder.day")}</span>
                  <input
                    type="number"
                    value={step.day}
                    min={1}
                    onChange={(e) => updateEscDay(i, parseInt(e.target.value) || 0)}
                    className="h-10 px-3 text-13 w-[64px] outline-none font-medium"
                    style={fieldStyle}
                  />
                </div>
              ))}
              {escalationInvalid && (
                <p className="text-12 leading-snug" style={{ color: "var(--error)" }}>
                  {t("reminder.escalationOrder")}
                </p>
              )}
            </div>
          )}

          {/* Ends */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("reminder.ends")}</p>
            <SelectorField
              value={local.ends}
              options={[
                { value: "paid", label: t("reminder.untilPaid") },
                { value: "date", label: t("reminder.specificDate") },
                { value: "count", label: t("reminder.afterCount") },
              ]}
              placeholder={t("reminder.untilPaid")}
              title={t("reminder.ends")}
              onChange={(v) => update("ends", v as ReminderEnds)}
              showTile={false}
            />
          </div>

          {/* Ends date */}
          {local.ends === "date" && (
            <div>
              <input
                type="date"
                value={local.endsDate ?? ""}
                onChange={(e) => update("endsDate", e.target.value || null)}
                className="w-full outline-none font-medium"
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
              <span className="text-13" style={{ color: "var(--text-secondary)" }}>{t("reminder.reminders")}</span>
            </div>
          )}

          {/* Summary */}
          <div
            className="rounded-[var(--radius-card)] p-4 text-13 leading-relaxed"
            style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--brand, #639922)", borderLeft: "3px solid var(--brand, #639922)" }}
          >
            {buildSummary(local, t)}
          </div>

          {/* Save button */}
          <button
            onClick={() => onSave({ ...local, id: local.id || "new-" + Date.now(), enabled: true })}
            disabled={escalationInvalid}
            className="w-full h-12 rounded-full text-14 font-bold transition-opacity active:opacity-80 disabled:opacity-50"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            {t("reminder.saveSchedule")}
          </button>
        </div>
      </div>
    </div>
  );
}
