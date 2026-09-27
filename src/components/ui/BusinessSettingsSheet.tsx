import { useState, useEffect } from "react";
import { useDelayedDismiss } from "@/hooks/usePresence";

/** Matches --dur-3, the sheet duration token. */
const SHEET_MS = 280;
import { X, Plus, Trash2 } from "lucide-react";
import SelectorField from "./SelectorField";
import type { CropConfig, BusinessSettings } from "@/types";
import { useT } from "@/lib/i18n";
import { useAuthStore } from "@/stores/authStore";

const PRESET_CROPS = ["Cotton", "Wheat", "Rice", "Sugarcane", "Maize", "Tobacco"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/**
 * Which crops a shop grows is that shop's configuration, so the device-local copy is kept per
 * shop — the same reason `localCache` is keyed by its owner and the group registry by tenant.
 * Under one key for the whole device, a second shop opened the crop list the first shop had
 * configured and would save it back as its own (the database copy is written too, but the sheet
 * reads this one for display).
 */
function settingsKey(): string {
  const tenant = useAuthStore.getState().user?.tenantId ?? "none";
  return `business_settings:${tenant}`;
}

function loadSettings(): BusinessSettings {
  try { const raw = localStorage.getItem(settingsKey()); if (raw) return JSON.parse(raw); } catch {}
  return { crops: [] };
}
function saveSettings(s: BusinessSettings) { localStorage.setItem(settingsKey(), JSON.stringify(s)); }

interface Props { onClose: () => void; onSave: () => void; }

export default function BusinessSettingsSheet({ onClose, onSave }: Props) {
  const t = useT();
  const [settings, setSettings] = useState<BusinessSettings>(loadSettings);
  const [customCrop, setCustomCrop] = useState("");
  /** In-flight crop names, keyed by the name they started with. Only used while typing. */
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const { closing, dismiss } = useDelayedDismiss(onClose, SHEET_MS);
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

  /**
   * Renaming a crop in place.
   *
   * The name is the key every other row in this list is matched by, so two rows may never share
   * one: a rename that collides with an existing crop, or leaves the field empty, is dropped and
   * the old name stays. Committed on leaving the field or on Enter rather than per keystroke, so
   * the list does not re-order itself around what is being typed.
   */
  function commitRename(oldName: string, raw: string) {
    const next = raw.trim();
    setNameDrafts((prev) => {
      const copy = { ...prev };
      delete copy[oldName];
      return copy;
    });
    if (!next || next === oldName) return;
    if (settings.crops.some((c) => c.name === next)) return;
    setSettings((prev) => ({
      ...prev,
      crops: prev.crops.map((c) => (c.name === oldName ? { ...c, name: next } : c)),
    }));
  }

  const fieldStyle = {
    background: "var(--surface-2)",
    color: "var(--text-primary)",
    border: "1px solid var(--divider)",
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
        style={{ background: "var(--tone-sheet)", maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: "var(--divider)" }} />
        </div>

        {/* Header */}
        <div className="px-5 pb-4 flex items-center justify-between">
          <p className="text-16 font-semibold" style={{ color: "var(--text-primary)" }}>{t("common.businessSettings")}</p>
          <button
            onClick={dismiss}
            className="size-8 rounded-full flex items-center justify-center ds-pressable"
            style={{ background: "var(--sheet-chip)" }}
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
                    className="h-10 px-4 rounded-full text-13 font-medium transition-colors"
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
                className="flex-1 h-12 px-4 text-13 outline-none"
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
                    className="rounded-[var(--radius-card)] p-4"
                    style={{ background: "var(--tone-card)" }}
                  >
                    {/* Crop name (editable) + delete */}
                    <div className="flex items-center justify-between mb-3">
                      <input
                        value={nameDrafts[crop.name] ?? crop.name}
                        onChange={(e) =>
                          setNameDrafts((prev) => ({ ...prev, [crop.name]: e.target.value }))
                        }
                        onBlur={(e) => commitRename(crop.name, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitRename(crop.name, (e.target as HTMLInputElement).value);
                          }
                        }}
                        aria-label={t("bizSettings.renameCrop")}
                        className="flex-1 h-9 px-2.5 text-14 font-semibold outline-none me-2"
                        style={{ ...fieldStyle, borderRadius: "10px" }}
                      />
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

                    {/* Harvest month + day — chosen in our own picker, never the
                        OS/browser select popup, which cannot follow the theme. */}
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <p className="text-10 font-medium mb-1" style={{ color: "var(--text-secondary)" }}>{t("settings.month")}</p>
                        <SelectorField
                          value={String(crop.harvestMonth)}
                          options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
                          placeholder={t("settings.month")}
                          title={t("settings.month")}
                          onChange={(v) => updateHarvestMonth(crop.name, parseInt(v))}
                          showTile={false}
                        />
                      </div>
                      <div className="w-[96px]">
                        <p className="text-10 font-medium mb-1" style={{ color: "var(--text-secondary)" }}>{t("common.day")}</p>
                        <SelectorField
                          value={String(crop.harvestDay)}
                          options={Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
                          placeholder={t("common.day")}
                          title={t("common.day")}
                          onChange={(v) => updateHarvestDay(crop.name, parseInt(v))}
                          showTile={false}
                        />
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
            className="w-full h-12 rounded-full text-14 font-bold transition-opacity active:opacity-80"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            {t("settings.saveBusinessSettings")}
          </button>
        </div>
      </div>
    </div>
  );
}
