import { useState, useEffect } from "react";
import { X, ChevronDown } from "lucide-react";
import type { ReminderConfig, ReminderRepeat, ReminderEnds, ReminderAnchor } from "@/types";

const DEFAULT_CONFIG: ReminderConfig = {
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

const ANCHOR_LABELS: Record<ReminderAnchor, string> = {
  after_credit: "after credit given",
  after_due: "after due date",
  before_harvest: "before harvest season",
};

function buildSummary(config: ReminderConfig): string {
  const anchorText = ANCHOR_LABELS[config.anchor];
  let endsText = "";
  if (config.ends === "paid") endsText = "stops automatically once the balance is paid";
  else if (config.ends === "date") endsText = "stops on " + (config.endsDate || "the selected date");
  else endsText = "stops after " + config.endsCount + " reminders";

  if (config.repeat === "once") {
    return "Sends one reminder " + config.startDays + " days " + anchorText + ", then " + endsText + ".";
  } else if (config.repeat === "interval") {
    return "Starting " + config.startDays + " days " + anchorText + ", sends a reminder every " + config.intervalN + " " + config.intervalUnit + " \u2014 " + endsText + ".";
  } else {
    const parts = config.escalation.map(function(s) { return s.tone + " at day " + s.day; });
    return "Sends a " + parts.join(", a ") + " \u2014 " + endsText + ".";
  }
}

interface Props {
  config: ReminderConfig | null;
  onSave: (config: ReminderConfig) => void;
  onClose: () => void;
}

export default function ReminderConfigSheet({ config, onSave, onClose }: Props) {
  const [local, setLocal] = useState<ReminderConfig>(config ?? { ...DEFAULT_CONFIG });

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
          <p className="text-[16px] font-semibold" style={{ color: "var(--text-primary)" }}>Configure Reminder</p>
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
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>Start reminders</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={local.startDays}
                min={0}
                onChange={(e) => update("startDays", parseInt(e.target.value) || 0)}
                className="h-12 px-4 text-sm w-[72px] outline-none font-medium"
                style={fieldStyle}
              />
              <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>days</span>
              <div className="flex-1 relative">
                <select
                  value={local.anchor}
                  onChange={(e) => update("anchor", e.target.value as ReminderAnchor)}
                  className="w-full h-12 px-4 pr-10 text-[13px] outline-none appearance-none font-medium"
                  style={fieldStyle}
                >
                  <option value="after_credit">after credit given</option>
                  <option value="after_due">after due date</option>
                  <option value="before_harvest">before harvest season</option>
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-secondary)" }} />
              </div>
            </div>
          </div>

          {/* Repeat */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>Repeat</p>
            <div className="relative">
              <select
                value={local.repeat}
                onChange={(e) => update("repeat", e.target.value as ReminderRepeat)}
                className="w-full h-12 px-4 pr-10 text-[13px] outline-none appearance-none font-medium"
                style={fieldStyle}
              >
                <option value="once">One-time reminder</option>
                <option value="interval">Every fixed interval</option>
                <option value="escalate">Escalating sequence</option>
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-secondary)" }} />
            </div>
          </div>

          {/* Interval fields */}
          {local.repeat === "interval" && (
            <div className="pl-4" style={{ borderLeft: "2px solid var(--brand)" }}>
              <div className="flex items-center gap-2">
                <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>Every</span>
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
                    className="h-12 px-3 pr-8 text-[13px] outline-none appearance-none font-medium"
                    style={fieldStyle}
                  >
                    <option value="days">days</option>
                    <option value="weeks">weeks</option>
                  </select>
                  <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-secondary)" }} />
                </div>
              </div>
            </div>
          )}

          {/* Escalation fields */}
          {local.repeat === "escalate" && (
            <div className="pl-4 flex flex-col gap-3" style={{ borderLeft: "2px solid var(--brand)" }}>
              {local.escalation.map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-[13px] w-[88px] shrink-0 font-medium" style={{ color: "var(--text-secondary)" }}>{step.label}</span>
                  <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>day</span>
                  <input
                    type="number"
                    value={step.day}
                    min={0}
                    onChange={(e) => updateEscDay(i, parseInt(e.target.value) || 0)}
                    className="h-12 px-3 text-sm w-[60px] outline-none font-medium"
                    style={fieldStyle}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Ends */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>Ends</p>
            <div className="relative">
              <select
                value={local.ends}
                onChange={(e) => update("ends", e.target.value as ReminderEnds)}
                className="w-full h-12 px-4 pr-10 text-[13px] outline-none appearance-none font-medium"
                style={fieldStyle}
              >
                <option value="paid">Until paid in full</option>
                <option value="date">On a specific date</option>
                <option value="count">After a number of reminders</option>
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
              <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>reminders</span>
            </div>
          )}

          {/* Summary */}
          <div
            className="rounded-[14px] p-4 text-[13px] leading-relaxed"
            style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
          >
            {buildSummary(local)}
          </div>

          {/* Save button */}
          <button
            onClick={() => onSave({ ...local, enabled: true })}
            className="w-full h-12 rounded-full text-[14px] font-bold transition-opacity active:opacity-80"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            Save Reminder Schedule
          </button>
        </div>
      </div>
    </div>
  );
}
