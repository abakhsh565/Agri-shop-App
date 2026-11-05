import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useUIStore } from "@/stores/uiStore";
import { useCatalogueStore } from "@/stores/catalogueStore";
import { setSkipNext } from "@/lib/navContext";
import type { BaseUnit } from "@/types";

/**
 * One unit: its name, its symbol, what it measures, and how precisely it is written.
 *
 * The reference asks only for precision; the other fields exist because they are load-bearing
 * here. A symbol is what appears after every quantity on a bill, and the measurement family is
 * what stock and pack sizes are arithmetic in — a unit that named a fourth family would put a
 * shelf into a measurement nothing else in the app can convert (0259). So the form asks all
 * four, in the order a shopkeeper thinks about them, and the save is the only button.
 *
 * The three families are the app's own: weight (kg), volume (liter) and count (piece). "Bori"
 * is a count of pieces or a weight in kilos depending on what the shop means, so the shop says
 * which rather than the app guessing from the name.
 */
export default function UnitFormPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const { unitId } = useParams();
  const isEdit = Boolean(unitId);
  const { addToast } = useUIStore();
  const units = useCatalogueStore((s) => s.units);
  const ready = useCatalogueStore((s) => s.ready);
  const saveUnit = useCatalogueStore((s) => s.saveUnit);

  const existing = isEdit ? units.find((u) => u.id === unitId) : undefined;

  const [name, setName] = useState(existing?.name ?? "");
  const [symbol, setSymbol] = useState(existing?.symbol ?? "");
  const [family, setFamily] = useState<BaseUnit>(existing?.baseUnit ?? "kg");
  const [precision, setPrecision] = useState(existing?.precision ?? 0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const adoptedRef = useRef(false);

  /** Adopt a row that arrives after the first render, without overwriting anyone's typing. */
  useEffect(() => {
    if (!isEdit || adoptedRef.current || !existing) return;
    adoptedRef.current = true;
    setName((v) => (v === "" ? existing.name : v));
    setSymbol((v) => (v === "" ? existing.symbol : v));
    setFamily((v) => (v === "kg" && existing.baseUnit !== "kg" ? existing.baseUnit : v));
    setPrecision((v) => (v === 0 ? existing.precision : v));
  }, [isEdit, existing]);

  async function handleSave() {
    setError("");
    const trimmedName = name.trim();
    const trimmedSymbol = symbol.trim();
    if (!trimmedName) {
      setError(t("units.nameRequired"));
      return;
    }
    if (!trimmedSymbol) {
      setError(t("units.symbolRequired"));
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await saveUnit({
        ...(isEdit && unitId ? { id: unitId } : {}),
        name: trimmedName,
        symbol: trimmedSymbol,
        baseUnit: family,
        precision,
      });
      addToast(t("units.saved"), "success");
      // Pop the form step rather than leaving it behind the list, so Back goes to the catalogue
      // and never reopens a form that was just saved.
      setSkipNext();
      navigate(`${base}/inventory/units`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("units.saveFailed"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const fieldStyle = {
    background: "var(--field-bg)",
    color: "var(--text-primary)",
  } as const;
  const labelCls = "text-11 font-medium mb-1.5";
  const chipCls = "shrink-0 h-9 px-4 rounded-full text-xs font-semibold transition-colors";

  const families: { value: BaseUnit; label: string }[] = [
    { value: "kg", label: t("units.weight") },
    { value: "liter", label: t("units.volume") },
    { value: "piece", label: t("units.count") },
  ];
  const precisions = [0, 1, 2, 3, 4];

  const missing = isEdit && ready && !existing;

  return (
    <div
      className="flex flex-col w-full min-h-full justify-between"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="unit-form-page"
    >
      <div>
        <StatusBar />
        <NavHeader
          title={isEdit ? t("units.edit") : t("units.new")}
          backTo={`${base}/inventory/units`}
        />

        <div className="p-4 flex flex-col gap-4">
          {missing ? (
            <p className="text-13 py-8 text-center" style={{ color: "var(--text-secondary)" }}>
              {t("units.gone")}
            </p>
          ) : (
            <>
              {/* Fields straight on the page, like the reference's Create unit screen. */}
              <div className="flex flex-col gap-5">
                <div>
                  <p className={labelCls} style={{ color: "var(--text-secondary)" }}>
                    {t("units.name")}
                  </p>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("units.namePlaceholder")}
                    maxLength={40}
                    autoFocus={!isEdit}
                    data-testid="unit-name"
                    className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
                    style={fieldStyle}
                  />
                </div>

                <div>
                  <p className={labelCls} style={{ color: "var(--text-secondary)" }}>
                    {t("units.symbol")}
                  </p>
                  <input
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    placeholder={t("units.symbolPlaceholder")}
                    maxLength={12}
                    data-testid="unit-symbol"
                    className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
                    style={fieldStyle}
                  />
                  <p className="text-11 mt-1.5" style={{ color: "var(--text-tertiary)" }}>
                    {t("units.symbolHint")}
                  </p>
                </div>

                <div>
                  <p className={labelCls} style={{ color: "var(--text-secondary)" }}>
                    {t("units.measures")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {families.map((f) => (
                      <button
                        key={f.value}
                        type="button"
                        onClick={() => setFamily(f.value)}
                        data-testid={`unit-family-${f.value}`}
                        className={chipCls}
                        style={{
                          background: family === f.value ? "var(--brand)" : "var(--surface-2)",
                          color: family === f.value ? "#0a0a0a" : "var(--text-secondary)",
                        }}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <p className="text-13 font-bold" style={{ color: "var(--text-primary)" }}>
                  {t("units.precision")}
                </p>
                <p className="text-12 mt-0.5 mb-2" style={{ color: "var(--text-secondary)" }}>
                  {t("units.precisionHint")}
                </p>
                <ListCard variant="plain">
                  {precisions.map((p) => (
                    <ListRow
                      key={p}
                      testId={`unit-precision-${p}`}
                      title={p === 0 ? t("units.wholeNumber") : `.${"0".repeat(p)}`}
                      selected={precision === p}
                      onClick={() => setPrecision(p)}
                      trailing={
                        <span
                          className="size-5 rounded-full flex items-center justify-center shrink-0"
                          style={{
                            border: `2px solid ${precision === p ? "var(--brand-dark)" : "var(--text-tertiary)"}`,
                          }}
                        >
                          {precision === p && (
                            <span
                              className="size-2.5 rounded-full"
                              style={{ background: "var(--brand-dark)" }}
                            />
                          )}
                        </span>
                      }
                    />
                  ))}
                </ListCard>
              </div>

              {error && (
                <p className="text-xs" style={{ color: "var(--error)" }} role="alert">
                  {error}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {!missing && (
        <div className="p-4 pb-6">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            data-testid="unit-save"
            className="w-full h-12 rounded-full font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      )}
    </div>
  );
}
