import { useState, useEffect } from "react";
import { X, Users, ChevronDown } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import CustomerSelector from "./CustomerSelector";
import type { ReminderConfig, ReminderRepeat, ReminderEnds, ReminderAnchor } from "@/types";

const DEFAULT_CONFIG: ReminderConfig = {
  id: "new-group-" + Date.now(),
  enabled: true,
  startDays: 3,
  anchor: "before_due",
  repeat: "interval",
  intervalN: 2,
  intervalUnit: "days",
  escalation: [],
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
    const parts = config.escalation.map(s => s.day + " " + t("reminder.day", "day"));
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
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const [step, setStep] = useState<"customers" | "config">("customers");
  const [groupName, setGroupName] = useState(initGroupName || "");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initSelected || []));
  const [config, setConfig] = useState<ReminderConfig>(initConfig ?? { ...DEFAULT_CONFIG, id: "new-group-" + Date.now() });

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  function updateConfig<K extends keyof ReminderConfig>(key: K, value: ReminderConfig[K]) {
    setConfig(prev => ({ ...prev, [key]: value }));
  }

  const fieldStyle = {
    background: "var(--surface-2)",
    color: "var(--text-primary)",
    border: "1px solid var(--divider)",
    borderRadius: "24px",
  };
  const labelCls = "text-[11px] font-semibold uppercase tracking-wider mb-2 block";

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div
        className="w-full max-w-[390px] mx-auto rounded-t-[24px] flex flex-col"
        style={{ background: "var(--surface)", maxHeight: "92vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: "var(--divider)" }} />
        </div>

        <div className="px-5 pb-3 flex items-center justify-between">
          <p className="text-[16px] font-semibold" style={{ color: "var(--text-primary)" }}>
            {isUrdu ? "گروپ یاد دہانی بنائیں" : "Create Group Reminder"}
          </p>
          <button onClick={onClose} className="size-8 rounded-full flex items-center justify-center" style={{ background: "var(--surface-2)" }}>
            <X size={16} style={{ color: "var(--text-secondary)" }} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-5 pb-3 flex gap-2">
          <button
            onClick={() => setStep("customers")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold"
            style={{
              background: step === "customers" ? "var(--brand)" : "var(--surface-2)",
              color: step === "customers" ? "#0a0a0a" : "var(--text-secondary)",
            }}
          >
            <Users size={12} />
            {isUrdu ? "گاہک منتخب کریں" : "Select Customers"}
          </button>
          <button
            onClick={() => setStep("config")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold"
            style={{
              background: step === "config" ? "var(--brand)" : "var(--surface-2)",
              color: step === "config" ? "#0a0a0a" : "var(--text-secondary)",
            }}
          >
            {isUrdu ? "ترتیب" : "Configure"}
          </button>
        </div>

        <div className="px-5 pb-6 flex flex-col gap-4 overflow-y-auto" style={{ flex: 1 }}>
          {step === "customers" ? (
            <>
              {/* Group name */}
              <div>
                <label className={labelCls} style={{ color: "var(--text-secondary)" }}>
                  {isUrdu ? "گروپ کا نام" : "Group Name"}
                </label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder={isUrdu ? "مثلاً: کریڈٹ پیروی" : "e.g., Credit Payment Follow-up"}
                  className="w-full h-12 px-4 text-[13px] outline-none font-medium"
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
                  className="w-full h-12 rounded-full text-[14px] font-bold"
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
                className="text-[12px] font-semibold flex items-center gap-1"
                style={{ color: "var(--brand-dark, #65a30d)" }}
              >
                ← {isUrdu ? "واپس گاہک" : "Back to customers"}
              </button>

              {/* Config form (same fields as ReminderConfigSheet) */}
              <div>
                <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("reminder.startReminders")}</p>
                <div className="flex items-center gap-2">
                  <input type="number" value={config.startDays} min={0}
                    onChange={(e) => updateConfig("startDays", parseInt(e.target.value) || 0)}
                    className="h-12 px-4 text-sm w-[72px] outline-none font-medium" style={fieldStyle} />
                  <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{t("reminder.days")}</span>
                  <div className="flex-1 relative">
                    <select value={config.anchor}
                      onChange={(e) => updateConfig("anchor", e.target.value as ReminderAnchor)}
                      className="w-full h-12 px-4 pe-10 text-[13px] outline-none appearance-none font-medium" style={fieldStyle}>
                      <option value="after_credit">{t("reminder.afterCreditGiven")}</option>
                      <option value="before_due">{t("reminder.beforeDueDateFull")}</option>
                      <option value="after_due">{t("reminder.afterDueDateFull")}</option>
                      <option value="before_harvest">{t("reminder.beforeHarvestFull")}</option>
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-secondary)" }} />
                  </div>
                </div>
              </div>

              <div>
                <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("reminder.repeat")}</p>
                <div className="relative">
                  <select value={config.repeat}
                    onChange={(e) => updateConfig("repeat", e.target.value as ReminderRepeat)}
                    className="w-full h-12 px-4 pe-10 text-[13px] outline-none appearance-none font-medium" style={fieldStyle}>
                    <option value="once">{t("reminder.oneTimeReminder")}</option>
                    <option value="interval">{t("reminder.fixedInterval")}</option>
                    <option value="escalate">{t("reminder.escalatingSeq")}</option>
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-secondary)" }} />
                </div>
              </div>

              {config.repeat === "interval" && (
                <div className="ps-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{t("reminder.every")}</span>
                    <input type="number" value={config.intervalN} min={1}
                      onChange={(e) => updateConfig("intervalN", parseInt(e.target.value) || 1)}
                      className="h-12 px-3 text-sm w-[60px] outline-none font-medium" style={fieldStyle} />
                    <div className="relative">
                      <select value={config.intervalUnit}
                        onChange={(e) => updateConfig("intervalUnit", e.target.value as "days" | "weeks")}
                        className="h-12 px-3 pe-8 text-[13px] outline-none appearance-none font-medium" style={fieldStyle}>
                        <option value="days">{t("reminder.days")}</option>
                        <option value="weeks">{t("reminder.weeks")}</option>
                      </select>
                      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-secondary)" }} />
                    </div>
                  </div>
                </div>
              )}

              {config.repeat === "escalate" && (
                <div className="ps-4 flex flex-col gap-3">
                  {config.escalation.map((step, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-[13px] w-[96px] shrink-0 font-medium" style={{ color: "var(--text-secondary)" }}>
                        {step.label === "Gentle" ? t("reminder.gentle") : step.label === "Firmer" ? t("reminder.firmer") : t("reminder.finalNotice")}
                      </span>
                      <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>{t("reminder.day")}</span>
                      <input type="number" value={step.day} min={0}
                        onChange={(e) => {
                          const esc = [...config.escalation];
                          esc[i] = { ...esc[i], day: parseInt(e.target.value) || 0 };
                          updateConfig("escalation", esc);
                        }}
                        className="h-10 px-3 text-[13px] w-[64px] outline-none font-medium" style={fieldStyle} />
                    </div>
                  ))}
                </div>
              )}

              <div>
                <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("reminder.ends")}</p>
                <div className="relative">
                  <select value={config.ends}
                    onChange={(e) => updateConfig("ends", e.target.value as ReminderEnds)}
                    className="w-full h-12 px-4 pe-10 text-[13px] outline-none appearance-none font-medium" style={fieldStyle}>
                    <option value="paid">{t("reminder.untilPaid")}</option>
                    <option value="date">{t("reminder.specificDate")}</option>
                    <option value="count">{t("reminder.afterCount")}</option>
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-secondary)" }} />
                </div>
              </div>

              {config.ends === "date" && (
                <input type="date" value={config.endsDate ?? ""}
                  onChange={(e) => updateConfig("endsDate", e.target.value || null)}
                  className="w-full h-12 px-4 text-sm outline-none font-medium" style={fieldStyle} />
              )}

              {config.ends === "count" && (
                <div className="flex items-center gap-2">
                  <input type="number" value={config.endsCount} min={1}
                    onChange={(e) => updateConfig("endsCount", parseInt(e.target.value) || 1)}
                    className="h-12 px-4 text-sm w-[80px] outline-none font-medium" style={fieldStyle} />
                  <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{t("reminder.reminders")}</span>
                </div>
              )}

              {/* Summary */}
              <div className="rounded-[14px] p-4 text-[13px] leading-relaxed"
                style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--brand, #639922)", borderLeft: "3px solid var(--brand, #639922)" }}>
                {buildSummary(config, t)}
              </div>

              {/* Group summary */}
              <div className="rounded-[14px] p-3 text-[12px]" style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}>
                <p style={{ color: "var(--text-secondary)" }}>
                  {isUrdu ? `گروپ: ${groupName}` : `Group: ${groupName}`}
                </p>
                <p className="font-semibold mt-1" style={{ color: "var(--text-primary)" }}>
                  {selectedIds.size} {isUrdu ? "گاہک منتخب" : "customers selected"}
                </p>
              </div>

              <button
                onClick={() => onSave({ ...config, id: config.id || "new-group-" + Date.now(), enabled: true }, Array.from(selectedIds), groupName)}
                disabled={!groupName.trim() || selectedIds.size === 0}
                className="w-full h-12 rounded-full text-[14px] font-bold transition-opacity active:opacity-80 disabled:opacity-50"
                style={{ background: "var(--brand)", color: "#0a0a0a" }}
              >
                {isUrdu ? "گروپ محفوظ کریں" : "Save Group Reminder"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
