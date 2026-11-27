import { useEffect, useRef, useState } from "react";
import Sheet from "@/components/ui/Sheet";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import DateField from "@/components/ui/DateField";
import SelectorField from "@/components/ui/SelectorField";
import SegmentedTabs from "@/components/ui/SegmentedTabs";
import { useT } from "@/lib/i18n";

/**
 * A small group of facts, edited together.
 *
 * Two screens describe a record made of facts that belong to one another: the company's legal
 * identity, and one branch's operating facts. Neither is a form — the page reads the facts, and a
 * change is a deliberate act on the group — so both open this sheet instead of growing two bespoke
 * forms that drift apart.
 *
 * IT IS MADE OF THE APP'S OWN FORM PIECES, which is the only reason it can look like the rest of
 * the product: `Sheet` for the frame, `Input` for a typed fact, `DateField` for a day (the same
 * calendar every other screen opens), `SelectorField` for a choice or a time (the same picker the
 * rest of the app uses instead of a native dropdown), and `Button` — the quiet dark `cta`, not a
 * green slab. No colour, radius, type size or control is invented here.
 *
 * ONLY THE FACTS THAT CHANGED ARE SENT. The write functions treat an absent key as "leave this
 * alone" and an empty value as "clear it", so a sheet opened to fix a tax number cannot blank the
 * name the owner never looked at.
 */
export interface DetailField {
  key: string;
  label: string;
  kind: "text" | "date" | "time" | "choice";
  value: string;
  placeholder?: string;
  maxLength?: number;
  options?: { value: string; label: string }[];
  inputMode?: "text" | "numeric";
}

/** Half-hour steps across a working day — enough for an opening time, short enough to scan. */
function timeOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let minutes = 5 * 60; minutes <= 23 * 60 + 30; minutes += 30) {
    const hours = Math.floor(minutes / 60).toString().padStart(2, "0");
    const mins = (minutes % 60).toString().padStart(2, "0");
    out.push({ value: `${hours}:${mins}`, label: `${hours}:${mins}` });
  }
  return out;
}

export default function RecordDetailSheet({
  open,
  title,
  fields,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  fields: DetailField[];
  onClose: () => void;
  onSave: (patch: Record<string, string>) => Promise<void>;
}) {
  const t = useT();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  // The sheet opens on what the record holds now, every time. A draft left over from a previous
  // opening would offer to "save" a value the record already has.
  useEffect(() => {
    if (!open) return;
    setDraft(Object.fromEntries(fields.map((field) => [field.key, field.value])));
    setError(null);
    setBusy(false);
    busyRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeded from the values at open time
  }, [open]);

  async function save() {
    if (busyRef.current) return;
    const patch: Record<string, string> = {};
    for (const field of fields) {
      const next = (draft[field.key] ?? "").trim();
      if (next !== (field.value ?? "").trim()) patch[field.key] = next;
    }
    if (Object.keys(patch).length === 0) {
      setError(t("business.nothingChanged"));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSave(patch);
      onClose();
    } catch {
      setError(t("business.saveFailed"));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const optionsFor = (field: DetailField) =>
    field.options ?? (field.kind === "time" ? timeOptions() : []);

  return (
    <Sheet open={open} title={title} onClose={onClose} closeButton>
      <div className="px-5 pb-6 flex flex-col gap-4">
        {fields.map((field) => {
          if (field.kind === "text") {
            return (
              <Input
                key={field.key}
                label={field.label}
                value={draft[field.key] ?? ""}
                onChange={(event) => {
                  const next = event.target.value;
                  setDraft((current) => ({ ...current, [field.key]: next }));
                  setError(null);
                }}
                placeholder={field.placeholder}
                maxLength={field.maxLength}
                inputMode={field.inputMode ?? "text"}
                data-testid={`detail-input-${field.key}`}
              />
            );
          }

          if (field.kind === "date") {
            return (
              <div key={field.key} className="flex flex-col gap-2">
                <span className="text-11 font-semibold tracking-wide" style={{ color: "var(--text-secondary)" }}>
                  {field.label}
                </span>
                <DateField
                  value={draft[field.key] ?? ""}
                  onChange={(value) => setDraft((current) => ({ ...current, [field.key]: value }))}
                  ariaLabel={field.label}
                  testId={`detail-date-${field.key}`}
                />
              </div>
            );
          }

          // A choice of a few is the app's tab control, the one every other short choice uses
          // (Rs/% on the till, the discount scope). The picker is for a list you have to search.
          if (field.kind === "choice") {
            return (
              <div key={field.key} className="flex flex-col gap-2">
                <span className="text-11 font-semibold tracking-wide" style={{ color: "var(--text-secondary)" }}>
                  {field.label}
                </span>
                <SegmentedTabs
                  items={(field.options ?? []).map((option) => ({ key: option.value, label: option.label }))}
                  value={draft[field.key] ?? ""}
                  onChange={(key) => setDraft((current) => ({ ...current, [field.key]: key }))}
                  ariaLabel={field.label}
                  testId={`detail-choice-${field.key}`}
                  itemTestId={(key) => `detail-choice-${field.key}-${key}`}
                />
              </div>
            );
          }

          return (
            <div key={field.key} className="flex flex-col gap-2">
              <span className="text-11 font-semibold tracking-wide" style={{ color: "var(--text-secondary)" }}>
                {field.label}
              </span>
              <SelectorField
                value={draft[field.key] ?? ""}
                options={optionsFor(field)}
                placeholder={field.placeholder ?? t("branchPage.notSet")}
                title={field.label}
                onChange={(value) => setDraft((current) => ({ ...current, [field.key]: value }))}
                showTile={false}
              />
            </div>
          );
        })}

        {error && <p className="text-12" style={{ color: "var(--error)" }} role="alert">{error}</p>}

        <Button variant="cta" size="lg" fullWidth onClick={() => void save()} loading={busy} testId="detail-save">
          {t("common.save")}
        </Button>
      </div>
    </Sheet>
  );
}
