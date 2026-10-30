import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SelectorField from "@/components/ui/SelectorField";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useUIStore } from "@/stores/uiStore";
import { useCatalogueStore } from "@/stores/catalogueStore";
import { setSkipNext } from "@/lib/navContext";
import { categoryDisplayName, orderedCategories } from "@/lib/catalogue";

/**
 * One shelf: its name, and the shelf it lives under.
 *
 * The reference asks exactly these two things — a name, then "Parent category" — and saves from
 * the header. That is the whole form on purpose: a category is a label, and every extra field
 * is a decision the shopkeeper did not come here to make.
 *
 * ONE LEVEL. The parent picker offers the top-level shelves and "None". A shelf that already
 * has children cannot move, because its children would end up two levels down; the database
 * refuses that too, and the form says why rather than letting the save fail.
 *
 * THE SEEDED SEVEN ARE RENAMABLE. A shop that calls pesticides "Keet Nashak" can type that
 * name; from then on the row is theirs and the app prints it instead of its own translated
 * label (0259). Nothing about a product's kind changes — only the name on its shelf.
 */
export default function CategoryFormPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const { categoryId } = useParams();
  const isEdit = Boolean(categoryId);
  const { addToast } = useUIStore();
  const categories = useCatalogueStore((s) => s.categories);
  const ready = useCatalogueStore((s) => s.ready);
  const saveCategory = useCatalogueStore((s) => s.saveCategory);

  const existing = isEdit ? categories.find((c) => c.id === categoryId) : undefined;
  const hasChildren = Boolean(existing) && categories.some((c) => c.parentId === categoryId);

  const [name, setName] = useState(existing?.name ?? "");
  const [parentId, setParentId] = useState(existing?.parentId ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // A ref, not `saving`: React batches, so two taps in one task both read the pre-render false
  // and the shelf is created twice (the reentrancy rule the whole app follows).
  const savingRef = useRef(false);
  const adoptedRef = useRef(false);

  /**
   * Adopt the row once it arrives.
   *
   * A deep link or a refresh opens this screen before the catalogue has loaded, so the two
   * initialisers above read nothing. A field is filled only while it still holds what it
   * started with, so a late row can never overwrite what a person has typed.
   */
  useEffect(() => {
    if (!isEdit || adoptedRef.current || !existing) return;
    adoptedRef.current = true;
    setName((v) => (v === "" ? existing.name : v));
    setParentId((v) => (v === "" ? existing.parentId ?? "" : v));
  }, [isEdit, existing]);

  const parentOptions = useMemo(() => {
    const lines = orderedCategories(categories).filter(({ category }) => !category.parentId && category.id !== categoryId);
    return [
      { value: "", label: t("categories.none"), meta: t("categories.noneHint") },
      ...lines.map(({ category }) => ({
        value: category.id,
        label: categoryDisplayName(category, t),
        meta: t("categories.topLevel"),
      })),
    ];
    // `t` is stable for a language; the options follow the shop's shelves and this row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, categoryId]);

  async function handleSave() {
    setError("");
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("categories.nameRequired"));
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await saveCategory({
        ...(isEdit && categoryId ? { id: categoryId } : {}),
        name: trimmed,
        parentId: parentId || null,
      });
      addToast(t("categories.saved"), "success");
      // The form is a step the save UNDOES, not a step to keep: without this the tracker pushes
      // the list as a new screen with the completed form behind it, and Back reopens a blank
      // form. `setSkipNext` is the module's "this navigation pops the current frame" signal.
      setSkipNext();
      navigate(`${base}/inventory/categories`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("categories.saveFailed"));
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

  const missing = isEdit && ready && !existing;

  return (
    <div
      className="flex flex-col w-full min-h-full justify-between"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="category-form-page"
    >
      <div>
        <StatusBar />
        <NavHeader
          title={isEdit ? t("categories.edit") : t("categories.new")}
          backTo={`${base}/inventory/categories`}
        />

        <div className="p-4">
          {missing ? (
            <p className="text-13 py-8 text-center" style={{ color: "var(--text-secondary)" }}>
              {t("categories.gone")}
            </p>
          ) : (
            // The fields sit on the page: a box around two questions added an edge that grouped
            // nothing the labels did not already group (owner's correction, 2026-10-31).
            <div className="flex flex-col gap-5">
              <div>
                <p className={labelCls} style={{ color: "var(--text-secondary)" }}>
                  {t("categories.name")}
                </p>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("categories.namePlaceholder")}
                  maxLength={60}
                  autoFocus={!isEdit}
                  data-testid="category-name"
                  className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
                  style={fieldStyle}
                />
              </div>

              <div>
                <p className={labelCls} style={{ color: "var(--text-secondary)" }}>
                  {t("categories.parent")}
                </p>
                <SelectorField
                  value={parentId}
                  options={parentOptions}
                  placeholder={t("categories.none")}
                  title={t("categories.parent")}
                  onChange={setParentId}
                  searchable={parentOptions.length > 6}
                  showTile={false}
                  disabled={hasChildren}
                />
                <p className="text-11 mt-1.5" style={{ color: "var(--text-tertiary)" }}>
                  {hasChildren ? t("categories.hasChildrenHint") : t("categories.parentHint")}
                </p>
              </div>

              {error && (
                <p className="text-xs" style={{ color: "var(--error)" }} role="alert">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {!missing && (
        <div className="p-4 pb-6">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            data-testid="category-save"
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
