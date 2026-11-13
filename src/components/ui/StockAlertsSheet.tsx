import { useState, useEffect, useRef } from "react";
import { useDelayedDismiss } from "@/hooks/usePresence";
import { X, Check, Loader2 } from "lucide-react";
import { useT, type I18nKey } from "@/lib/i18n";
import { useUIStore } from "@/stores/uiStore";
import { useProductsStore } from "@/stores/productsStore";
import {
  ALERT_FREQUENCIES,
  DEFAULT_STOCK_ALERT_SETTINGS,
  applyThresholdToAllProducts,
  loadStockAlertSettings,
  saveStockAlertSettings,
  type AlertFrequency,
  type StockAlertSettings,
} from "@/lib/stockAlerts";

/** Matches --dur-3, the sheet duration token. */
const SHEET_MS = 280;

/**
 * The shop's stock-alert policy, in the owner's words rather than the schema's.
 *
 * Two questions, asked plainly:
 *
 *   1. "Warn me when stock drops to 20" — a number, in the shop's own units.
 *   2. "How often should I hear about it" — once when it crosses, once a day, or every
 *      few days.
 *
 * and one secondary action that only appears when it has something to do: products whose
 * own number still differs from the shop's. Before this sheet existed the number that
 * governed every low-stock screen was a hardcoded fallback in three different files, and
 * `app_settings.low_stock_threshold_default` sat unread in the database — so an owner
 * could not see, let alone change, the rule they were being alerted by.
 *
 * The frequency is the answer to a real complaint: `checkAndNotifyLowStock` fired on
 * every sale that left stock at or under the line, so selling ten packs in an afternoon
 * produced ten identical alerts and the screen taught the shop to ignore it.
 */
interface Props {
  onClose: () => void;
  onSaved?: (settings: StockAlertSettings) => void;
}

export default function StockAlertsSheet({ onClose, onSaved }: Props) {
  const t = useT();
  const { addToast } = useUIStore();
  const products = useProductsStore((s) => s.products);
  const { closing, dismiss } = useDelayedDismiss(onClose, SHEET_MS);

  const [settings, setSettings] = useState<StockAlertSettings>(DEFAULT_STOCK_ALERT_SETTINGS);
  const [thresholdText, setThresholdText] = useState(String(DEFAULT_STOCK_ALERT_SETTINGS.threshold));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);

  // The re-entry gate has to be synchronous. `disabled={saving}` is applied on the next
  // render, and React batches, so two taps in one task — which is what a double tap is —
  // both reach these handlers before it exists. Two saves are harmless (the second writes
  // the same number), but two applies would run the catalogue sweep twice, so the claim is
  // taken before the first await and released in `finally`.
  const savingRef = useRef(false);
  const applyingRef = useRef(false);

  // Lock background scroll — the same contract every sheet in the app keeps.
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // The policy lives in the database, so the sheet waits for it rather than showing a
  // number it invented and then silently changing it under the owner's finger.
  useEffect(() => {
    let alive = true;
    loadStockAlertSettings()
      .then((loaded) => {
        if (!alive) return;
        setSettings(loaded);
        setThresholdText(String(loaded.threshold));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const threshold = Math.max(0, Math.floor(Number(thresholdText) || 0));

  /**
   * Products still governed by a different number.
   *
   * Counted from the catalogue the app is already holding rather than asked of the
   * server, because this only decides whether the secondary action is worth showing. The
   * authoritative count is the one the apply call returns.
   */
  const differing = products.filter((p) =>
    p.variants.some((v) => v.lowStockThreshold !== threshold)
  ).length;

  async function handleSave() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await saveStockAlertSettings({ threshold, frequency: settings.frequency });
      setSettings(saved);
      setThresholdText(String(saved.threshold));
      addToast(t("stockAlerts.saved"), "success");
      onSaved?.(saved);
      dismiss();
    } catch (err) {
      // Say it failed rather than closing over it: the owner's next assumption would be
      // that their shop is being watched at a number that was never stored.
      if (import.meta.env.DEV) console.error("[StockAlerts] save failed:", err);
      addToast(t("stockAlerts.failed"), "error");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleApplyToAll() {
    if (applyingRef.current) return;
    applyingRef.current = true;
    setApplying(true);
    try {
      // Save first: applying a number the shop has not actually adopted would leave the
      // catalogue and the policy disagreeing the moment the sheet closed.
      await saveStockAlertSettings({ threshold, frequency: settings.frequency });
      const updated = await applyThresholdToAllProducts(threshold);
      await useProductsStore.getState().load();
      addToast(t("stockAlerts.applied", { count: String(updated) }), "success");
      dismiss();
    } catch (err) {
      if (import.meta.env.DEV) console.error("[StockAlerts] apply failed:", err);
      addToast(t("stockAlerts.failed"), "error");
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  }

  const FREQUENCY_HINT: Record<AlertFrequency, I18nKey> = {
    on_cross: "stockAlerts.freq.on_cross.hint",
    daily: "stockAlerts.freq.daily.hint",
    every_3_days: "stockAlerts.freq.every_3_days.hint",
  };

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
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: "var(--divider)" }} />
        </div>

        <div className="px-5 pb-4 flex items-center justify-between">
          <p className="text-16 font-semibold" style={{ color: "var(--text-primary)" }}>
            {t("stockAlerts.title")}
          </p>
          <button
            onClick={dismiss}
            aria-label={t("common.close")}
            data-testid="stock-alerts-close"
            className="size-8 rounded-full flex items-center justify-center ds-pressable"
            style={{ background: "var(--sheet-chip)" }}
          >
            <X size={16} style={{ color: "var(--text-secondary)" }} />
          </button>
        </div>

        <div className="px-5 pb-6 flex flex-col gap-5 overflow-y-auto" style={{ flex: 1 }}>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8">
              <Loader2 size={16} className="animate-spin" style={{ color: "var(--text-secondary)" }} />
            </div>
          ) : (
            <>
              {/* The number */}
              <div>
                <p className="ds-section-label mb-1.5" style={{ color: "var(--text-secondary)" }}>
                  {t("stockAlerts.thresholdLabel")}
                </p>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={thresholdText}
                  onChange={(e) => setThresholdText(e.target.value)}
                  data-testid="stock-alerts-threshold"
                  className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
                  style={{
                    background: "var(--field-bg)",
                    color: "var(--text-primary)",
                  }}
                />
                <p className="text-11 mt-1.5" style={{ color: "var(--text-secondary)" }}>
                  {t("stockAlerts.thresholdHint")}
                </p>
              </div>

              {/* How often */}
              <div>
                <p className="ds-section-label mb-1.5" style={{ color: "var(--text-secondary)" }}>
                  {t("stockAlerts.frequencyLabel")}
                </p>
                <div className="flex flex-col gap-2">
                  {ALERT_FREQUENCIES.map((f) => {
                    const chosen = settings.frequency === f;
                    return (
                      <button
                        key={f}
                        type="button"
                        data-testid={`stock-alerts-freq-${f}`}
                        onClick={() => setSettings((s) => ({ ...s, frequency: f }))}
                        className="w-full text-start rounded-[var(--radius-card)] px-3.5 py-3 flex items-start gap-3 ds-pressable"
                        style={{
                          background: "var(--tone-card)",
                          border: `1px solid ${chosen ? "var(--brand)" : "var(--divider)"}`,
                        }}
                      >
                        <span
                          className="size-5 rounded-full shrink-0 flex items-center justify-center mt-0.5"
                          style={{
                            background: chosen ? "var(--brand)" : "transparent",
                            border: chosen ? "none" : "1.5px solid var(--divider)",
                          }}
                        >
                          {chosen && <Check size={13} strokeWidth={3} style={{ color: "#0a0a0a" }} />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-14 font-semibold" style={{ color: "var(--text-primary)" }}>
                            {t(`stockAlerts.freq.${f}` as I18nKey)}
                          </span>
                          <span className="block text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                            {t(FREQUENCY_HINT[f])}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Put the number on the products that predate it.
                  Only shown when it has something to do, and it says how many — an action
                  labelled "apply to all" that silently matches nothing is how the owner
                  learns to distrust the button. */}
              {differing > 0 && (
                <div>
                  <button
                    type="button"
                    data-testid="stock-alerts-apply-all"
                    onClick={handleApplyToAll}
                    disabled={applying || saving}
                    className="w-full h-11 rounded-full text-13 font-bold flex items-center justify-center gap-2 ds-pressable disabled:opacity-50"
                    style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
                  >
                    {applying && <Loader2 size={14} className="animate-spin" />}
                    {t("stockAlerts.applyAll")}
                  </button>
                  <p className="text-11 mt-1.5 text-center" style={{ color: "var(--text-secondary)" }}>
                    {t("stockAlerts.applyAllHint", { count: String(differing) })}
                  </p>
                </div>
              )}

              <button
                onClick={handleSave}
                disabled={saving || applying}
                data-testid="stock-alerts-save"
                className="w-full h-12 rounded-full text-14 font-bold transition-opacity active:opacity-80 disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: "var(--brand)", color: "#0a0a0a" }}
              >
                {saving && <Loader2 size={15} className="animate-spin" />}
                {t("common.save")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
