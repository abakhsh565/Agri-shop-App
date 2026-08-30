import { useState, useEffect } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import type { CropConfig, BusinessSettings } from "@/types";

const PRESET_CROPS = ["Cotton", "Wheat", "Rice", "Sugarcane", "Maize", "Tobacco"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function loadSettings(): BusinessSettings {
  try { const raw = localStorage.getItem("business_settings"); if (raw) return JSON.parse(raw); } catch {}
  return { crops: [] };
}
function saveSettings(s: BusinessSettings) { localStorage.setItem("business_settings", JSON.stringify(s)); }
interface Props { onClose: () => void; onSave: () => void; }
export default function BusinessSettingsSheet({ onClose, onSave }: Props) {
  const [settings, setSettings] = useState<BusinessSettings>(loadSettings);
  const [customCrop, setCustomCrop] = useState("");
  const selectedNames = settings.crops.map(c => c.name);
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
    toggleCrop(n); setCustomCrop("");
  }
  function handleSave() { saveSettings(settings); onSave(); onClose(); }
  const ss = { background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--divider)" };
  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="w-full max-w-[390px] mx-auto rounded-t-[24px] flex flex-col" style={{ background: "var(--surface)", maxHeight: "85vh" }} onClick={e => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full" style={{ background: "var(--divider)" }} /></div>
        <div className="px-5 pb-4 flex items-center justify-between">
          <p className="text-[16px] font-semibold" style={{ color: "var(--text-primary)" }}>Business Settings</p>
          <button onClick={onClose} className="size-8 rounded-full flex items-center justify-center" style={{ background: "var(--surface-2)" }}><X size={16} style={{ color: "var(--text-secondary)" }} /></button>
        </div>
        <div className="px-5 pb-6 flex flex-col gap-5 overflow-y-auto" style={{ flex: 1 }}>
          <div>
            <label className="text-[12px] font-semibold uppercase tracking-wide block mb-2" style={{ color: "var(--text-secondary)" }}>Crops you deal with</label>
            <div className="flex flex-wrap gap-2">
              {PRESET_CROPS.map(crop => {
                const active = selectedNames.includes(crop);
                return <button key={crop} onClick={() => toggleCrop(crop)} className="h-9 px-4 rounded-full text-[13px] font-medium transition-colors" style={{ background: active ? "var(--brand)" : "var(--surface-2)", color: active ? "#0a0a0a" : "var(--text-secondary)", border: active ? "none" : "1px solid var(--divider)" }}>{crop}</button>;
              })}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <input value={customCrop} onChange={e => setCustomCrop(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addCustomCrop(); }} placeholder="Add custom crop..." className="flex-1 h-10 rounded-[14px] px-4 text-[13px] outline-none" style={{ ...ss, borderRadius: "var(--radius)" }} />
              <button onClick={addCustomCrop} className="size-10 rounded-[14px] flex items-center justify-center shrink-0" style={{ background: "var(--brand)" }}><Plus size={16} color="#0a0a0a" /></button>
            </div>
          </div>
          {settings.crops.length > 0 && (
            <div>
              <label className="text-[12px] font-semibold uppercase tracking-wide block mb-2" style={{ color: "var(--text-secondary)" }}>Harvest periods</label>
              <div className="flex flex-col gap-3">
                {settings.crops.map(crop => (
                  <div key={crop.name} className="flex items-center gap-3 p-3 rounded-[14px]" style={{ background: "var(--surface-2)" }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{crop.name}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>Harvest:</span>
                        <div className="relative flex-1">
                          <select value={crop.harvestMonth} onChange={e => updateHarvestMonth(crop.name, parseInt(e.target.value))} className="w-full h-9 rounded-[12px] px-3 text-[12px] outline-none appearance-none font-medium" style={{ ...ss, borderRadius: "var(--radius)" }}>
                            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                          </select>
                        <select value={crop.harvestDay} onChange={e => updateHarvestDay(crop.name, parseInt(e.target.value))} className="w-[60px] h-9 rounded-[12px] px-2 text-[12px] outline-none appearance-none font-medium" style={{ ...ss, borderRadius: "var(--radius)" }}>
                          {Array.from({length: 31}, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                        </div>
                      </div>
                    </div>
                    <button onClick={() => { setSettings(prev => ({ ...prev, crops: prev.crops.filter(c => c.name !== crop.name) })); }} className="size-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(239,68,68,0.1)" }}><Trash2 size={14} color="#ef4444" /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <button onClick={handleSave} className="w-full h-12 rounded-full text-[14px] font-bold transition-opacity active:opacity-80" style={{ background: "var(--brand)", color: "#0a0a0a" }}>Save Business Settings</button>
        </div>
      </div>
    </div>
  );
}