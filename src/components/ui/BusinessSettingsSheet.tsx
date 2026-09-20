import { useState, useEffect } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import type { CropConfig, BusinessSettings } from "@/types";
import { useT } from "@/lib/i18n";

const PRESET_CROPS = ["Cotton", "Wheat", "Rice", "Sugarcane", "Maize", "Tobacco"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function loadSettings(): BusinessSettings {
  try { const raw = localStorage.getItem("business_settings"); if (raw) return JSON.parse(raw); } catch {}
  return { crops: [] };
}
function saveSettings(s: BusinessSettings) { localStorage.setItem("business_settings", JSON.stringify(s)); }

interface Props { onClose: () => void; onSave: () => void; }

export default function BusinessSettingsSheet({ onClose, onSave }: Props) {
  const t = useT();
  const [settings, setSettings] = useState<BusinessSettings>(loadSettings);
  const [customCrop, setCustomCrop] = useState("");
  const selectedNames = settings.crops.map(c => c.name);

  // Lock background scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  function toggleCrop(name: string) {
    setSettings(prev => {
      const exists = prev.crops.find(c => c.name === name);
      if (exists) return { ...prev, crops: prev.crops.filter(c => c.name !== name) };
      const dm = name === "Cotton" ? 8 : name === "Wheat" ? 4 : name === "Rice" ? 10 : name === "Sugarcane" ? 3 : 7;
      return { ...prev, crops: [...prev.crops, { name, harvestMonth: dm, harvestDay: 1 }] };
    });
  }

  function updateHarvestMonth(name: string, month: number) {
    setSettings(prev => ({ ...prev, crops: prev.crops.map(c => c.name === name ? { ...c, harvestMonth: month } : c) }));
  }

  function updateHarvestDay(name: string, day: number) {
    setSettings(prev => ({ ...prev, crops: prev.crops.map(c => c.name === name ? { ...c, harvestDay: day } : c) }));
  }

  function addCustomCrop() {
    const n = customCrop.trim();
    if (!n || selectedNames.includes(n)) return;
    toggleCrop(n);
    setCustomCrop("");
  }

  function handleSave() {
    saveSettings(settings);
    onSave();
    onClose();
  }

  const fieldStyle = {
    background: "var(--surface-2)",
    color: "var(--text-primary)",
    border: "1px solid var(--divider)",
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
        style={{ background: "var(--surface)", maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: "var(--divider)" }} />
        </div>

        {/* Header */}
        <div className="px-5 pb-4 flex items-center justify-between">
          <p className="text-[16px] font-semibold" style={{ color: "var(--text-primary)" }}>{t("common.businessSettings")}</p>
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

          {/* Crop selection */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("settings.cropsQuestion")}</p>
            <div className="flex flex-wrap gap-2">
              {PRESET_CROPS.map(crop => {
                const active = selectedNames.includes(crop);
                return (
                  <button
                    key={crop}
                    onClick={() => toggleCrop(crop)}
                    className="h-10 px-4 rounded-full text-[13px] font-medium transition-colors"
                    style={{
                      background: active ? "var(--brand)" : "var(--surface-2)",
                      color: active ? "#0a0a0a" : "var(--text-secondary)",
                      border: active ? "none" : "1px solid var(--divider)",
                    }}
                  >
                    {crop}
                  </button>
                );
              })}
            </div>

            {/* Add custom crop */}
            <div className="flex items-center gap-2 mt-3">
              <input
                value={customCrop}
                onChange={(e) => setCustomCrop(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addCustomCrop(); }}
                placeholder={t("bizSettings.addCropPlaceholder")}
                className="flex-1 h-12 px-4 text-[13px] outline-none"
                style={{ ...fieldStyle, borderRadius: "24px" }}
              />
              <button
                onClick={addCustomCrop}
                className="size-12 rounded-full flex items-center justify-center shrink-0"
                style={{ background: "var(--brand)" }}
              >
                <Plus size={16} color="#0a0a0a" />
              </button>
            </div>
          </div>

          {/* Harvest periods — card-based like Add Product variants */}
          {settings.crops.length > 0 && (
            <div>
              <p className={labelCls} style={{ color: "var(--text-secondary)" }}>{t("settings.harvestPeriods")}</p>
              <div className="flex flex-col gap-3">
                {settings.crops.map(crop => (
                  <div
                    key={crop.name}
                    className="rounded-[14px] p-4"
                    style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
                  >
                    {/* Crop name + delete */}
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>
                        {crop.name}
                      </p>
                      <button
                        onClick={() => setSettings(prev => ({
                          ...prev,
                          crops: prev.crops.filter(c => c.name !== crop.name),
                        }))}
                        className="size-8 rounded-full flex items-center justify-center"
                        style={{ background: "rgba(239,68,68,0.1)" }}
                      >
                        <Trash2 size={14} color="#ef4444" />
                      </button>
                    </div>

                    {/* Harvest month + day — full width selects matching Add Product */}
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <p className="text-[10px] font-medium mb-1" style={{ color: "var(--text-secondary)" }}>{t("settings.month")}</p>
                        <select
                          value={crop.harvestMonth}
                          onChange={(e) => updateHarvestMonth(crop.name, parseInt(e.target.value))}
                          className="w-full h-12 px-4 pe-10 text-[13px] outline-none appearance-none font-medium"
                          style={{ ...fieldStyle, borderRadius: "24px" }}
                        >
                          {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                        </select>
                        <div className="absolute right-3 bottom-3 pointer-events-none">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m6 9 6 6 6-6"/>
                          </svg>
                        </div>
                      </div>
                      <div className="w-[80px] relative">
                        <p className="text-[10px] font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Day</p>
                        <select
                          value={crop.harvestDay}
                          onChange={(e) => updateHarvestDay(crop.name, parseInt(e.target.value))}
                          className="w-full h-12 px-4 pe-10 text-[13px] outline-none appearance-none font-medium"
                          style={{ ...fieldStyle, borderRadius: "24px" }}
                        >
                          {Array.from({length: 31}, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                        <div className="absolute right-3 bottom-3 pointer-events-none">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m6 9 6 6 6-6"/>
                          </svg>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Save button */}
          <button
            onClick={handleSave}
            className="w-full h-12 rounded-full text-[14px] font-bold transition-opacity active:opacity-80"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            {t("settings.saveBusinessSettings")}
          </button>
        </div>
      </div>
    </div>
  );
}
