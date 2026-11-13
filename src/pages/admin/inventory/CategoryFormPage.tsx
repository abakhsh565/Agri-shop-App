import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, Trash2 } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import InlineSelect from "@/components/ui/InlineSelect";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useUIStore } from "@/stores/uiStore";
import { useCatalogueStore } from "@/stores/catalogueStore";
import { useProductsStore } from "@/stores/productsStore";
import { setSkipNext } from "@/lib/navContext";
import { categoryDisplayName, categoryItemCount, orderedCategories } from "@/lib/catalogue";
import {
  MEASUREMENT_FAMILIES,
  familyLabelKey,
  familyOfPhysicalForm,
  formForFamily,
  resolveClassification,
} from "@/lib/classification";
import type {
  ClassificationForm,
  ClassificationPreset,
  HandlingType,
  UnitGroup,
} from "@/types";

/** The family a stored profile opens on, for the one question this screen now asks. */
function firstFamily(forms: ClassificationForm[]): UnitGroup | "" {
  return forms[0] ? familyOfPhysicalForm(forms[0].code) : "";
}

/**
 * One shelf: its name, the shelf it lives under, and the physical forms products here can
 * arrive in.
 *
 * The reference asks only the first two; the forms are the one fact Add Product cannot infer
 * for a new shelf. Presets, compatible unit groups and handling types used to be separate
 * questions here. They were system settings leaking into a shopkeeper's job: the form now
 * derives each unit family from its form and keeps the rest of an existing profile untouched.
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
  const classifications = useCatalogueStore((s) => s.classifications);
  const ready = useCatalogueStore((s) => s.ready);
  const saveCategory = useCatalogueStore((s) => s.saveCategory);
  const deleteCategory = useCatalogueStore((s) => s.deleteCategory);
  const products = useProductsStore((s) => s.products);

  const existing = isEdit ? categories.find((c) => c.id === categoryId) : undefined;
  const linkedProducts = existing ? categoryItemCount(existing, categories, products) : 0;
  const childCount = existing ? categories.filter((c) => c.parentId === categoryId).length : 0;
  const deleteBlocked = linkedProducts > 0 || childCount > 0;
  const deleteBlockedLabel = linkedProducts > 0
    ? linkedProducts === 1
      ? t("categories.deleteBlockedProductsOne")
      : t("categories.deleteBlockedProducts", { count: String(linkedProducts) })
    : childCount > 0
      ? childCount === 1
        ? t("categories.deleteBlockedChildrenOne")
        : t("categories.deleteBlockedChildren", { count: String(childCount) })
      : "";

  const hasChildren = Boolean(existing) && categories.some((c) => c.parentId === categoryId);
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

  const [name, setName] = useState(existing?.name ?? "");
  const [parentId, setParentId] = useState(existing?.parentId ?? "");
  const ownProfile = categoryId ? classifications.find((p) => p.categoryId === categoryId) : undefined;
  const [classificationMode, setClassificationMode] = useState<"inherit" | "custom">(
    existing ? (ownProfile ? "custom" : existing.parentId ? "inherit" : "custom") : "custom",
  );
  // The preset and handling types are no longer questions on this screen. They are kept from
  // an existing profile so an edit does not erase data the owner configured before the form was
  // simplified; a new category gets neutral values.
  const [preset, setPreset] = useState<ClassificationPreset>(ownProfile?.preset ?? "general");
  // One measure is always chosen, so a new shelf is measurable from the moment it exists and
  // Add Product never meets a category with no unit behind it.
  const [family, setFamily] = useState<UnitGroup | "">(
    firstFamily(ownProfile?.physicalForms ?? []) || "weight",
  );
  const [handling, setHandling] = useState<HandlingType[]>(ownProfile?.handlingTypes ?? ["standard"]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // A ref, not `saving`: React batches, so two taps in one task both read the pre-render false
  // and the shelf is created twice (the reentrancy rule the whole app follows).
  const savingRef = useRef(false);
  const adoptedRef = useRef(false);
  const classificationAdoptedRef = useRef(false);
  const classificationModeTouched = useRef(false);
  const familyTouched = useRef(false);

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

  /** A newly-created category follows its first parent unless the owner has chosen otherwise. */
  useEffect(() => {
    if (isEdit || classificationModeTouched.current) return;
    setClassificationMode(parentId ? "inherit" : "custom");
  }, [isEdit, parentId]);

  /** Adopt a profile that arrived after the first render, without overwriting typing. */
  useEffect(() => {
    if (!isEdit || classificationAdoptedRef.current || !ready || !existing) return;
    classificationAdoptedRef.current = true;
    if (ownProfile) {
      setClassificationMode("custom");
      setPreset(ownProfile.preset);
      setFamily(firstFamily(ownProfile.physicalForms));
      setHandling(ownProfile.handlingTypes);
    } else {
      setClassificationMode(existing.parentId ? "inherit" : "custom");
    }
  }, [isEdit, ready, existing, ownProfile]);

  const inherited = parentId
    ? resolveClassification(parentId, categories, classifications)
    : null;
  const inheritedParent = parentId ? categories.find((c) => c.id === parentId) : null;

  function startOverride() {
    const source = ownProfile ?? inherited;
    setPreset(source?.preset ?? "general");
    setFamily(firstFamily(source?.physicalForms ?? []) || "weight");
    setHandling(source?.handlingTypes ?? ["standard"]);
    setClassificationMode("custom");
    classificationModeTouched.current = true;
  }

  function chooseFamily(next: UnitGroup) {
    familyTouched.current = true;
    setFamily(next);
  }

  async function handleSave() {
    setError("");
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("categories.nameRequired"));
      return;
    }
    if (classificationMode === "custom" && !family) {
      setError(t("classification.familyRequired"));
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
        classification: classificationMode === "custom"
          ? {
              preset,
              // An untouched profile keeps its detail; a chosen family is one form, because the
              // family is the only thing this screen asks now.
              physicalForms:
                ownProfile && !familyTouched.current
                  ? ownProfile.physicalForms
                  : [formForFamily(family as UnitGroup)],
              handlingTypes: handling,
            }
          : null,
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

  async function handleDelete() {
    if (!isEdit || !categoryId || !existing || deleting) return;
    setError("");
    setDeleting(true);
    try {
      const result = await deleteCategory(categoryId);
      if (!result.deleted) {
        setDeleteOpen(false);
        const count = result.reason === "has_children"
          ? result.childCount ?? childCount
          : result.productCount ?? linkedProducts;
        setError(
          result.reason === "has_children"
            ? count === 1
              ? t("categories.deleteBlockedChildrenOne")
              : t("categories.deleteBlockedChildren", { count: String(count) })
            : count === 1
              ? t("categories.deleteBlockedProductsOne")
              : t("categories.deleteBlockedProducts", { count: String(count) }),
        );
        return;
      }
      setDeleteOpen(false);
      addToast(t("categories.deleted"), "success");
      setSkipNext();
      navigate(`${base}/inventory/categories`, { replace: true });
    } catch (e) {
      setDeleteOpen(false);
      setError(e instanceof Error ? e.message : t("categories.deleteFailed"));
    } finally {
      setDeleting(false);
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
          right={
            isEdit && existing ? (
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                disabled={saving || deleting || deleteBlocked}
                aria-label={t("categories.delete")}
                data-testid="category-delete"
                className="size-9 rounded-full flex items-center justify-center active:opacity-70 disabled:opacity-40"
                style={{ background: "var(--error)", color: "#ffffff" }}
              >
                <Trash2 size={18} />
              </button>
            ) : undefined
          }
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
                <InlineSelect
                  value={parentId}
                  options={parentOptions}
                  label={t("categories.parent")}
                  placeholder={t("categories.none")}
                  testId="category-parent"
                  onChange={setParentId}
                  disabled={hasChildren}
                />
              </div>

              <div className="pt-4" style={{ borderTop: "1px solid var(--hairline)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-13 font-bold" style={{ color: "var(--text-primary)" }}>
                      {t("classification.family.title")}
                    </p>
                  </div>
                </div>

                {classificationMode === "inherit" ? (
                  <div className="mt-3 rounded-[var(--radius-card)] p-3" style={{ background: "var(--tone-card)" }}>
                    {inherited && inheritedParent ? (
                      <>
                        <p className="text-12 font-semibold" style={{ color: "var(--text-primary)" }}>
                          {t("classification.inheritedFrom", { name: categoryDisplayName(inheritedParent, t) })}
                        </p>
                        <p className="text-12 mt-1" style={{ color: "var(--text-secondary)" }}>
                          {[...new Set(inherited.physicalForms.map((form) => familyOfPhysicalForm(form.code)))]
                            .map((inheritedFamily) => t(familyLabelKey(inheritedFamily)))
                            .join(" · ")}
                        </p>
                      </>
                    ) : (
                      <p className="text-12" style={{ color: "var(--text-secondary)" }}>
                        {t("classification.noParentProfile")}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={startOverride}
                      data-testid="category-classification-override"
                      className="mt-2 text-12 font-semibold underline underline-offset-2"
                      style={{ color: "var(--brand-dark)" }}
                    >
                      {t("classification.override")}
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-col gap-4">
                    <div>
                      <div className="flex flex-col gap-2">
                        {MEASUREMENT_FAMILIES.map((option) => {
                          const selected = family === option.family;
                          return (
                            <button
                              key={option.family}
                              type="button"
                              aria-pressed={selected}
                              data-testid={`category-family-${option.family}`}
                              onClick={() => chooseFamily(option.family)}
                              className="ds-pressable w-full rounded-[var(--radius-card)] p-3 flex items-start gap-3 text-start"
                              style={{
                                background: selected ? "#2c2c2a" : "var(--surface-2)",
                                border: selected ? "1px solid #d4d4cf" : "1px solid transparent",
                              }}
                            >
                              <span className="min-w-0 flex-1">
                                <span
                                  className="block text-13 font-semibold"
                                  style={{ color: selected ? "#e4e4df" : "var(--text-primary)" }}
                                >
                                  {t(option.labelKey)}
                                </span>
                                <span
                                  className="block text-11 mt-0.5"
                                  style={{
                                    color: selected ? "#a9a9a2" : "var(--text-secondary)",
                                  }}
                                >
                                  {t(option.hintKey)}
                                </span>
                              </span>
                              {selected && (
                                <Check size={16} className="shrink-0 mt-0.5" style={{ color: "#e4e4df" }} />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                  </div>
                )}
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
        <div className="p-4 pb-6 flex flex-col gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || deleting}
            data-testid="category-save"
            className="w-full h-12 rounded-full font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ background: "#2c2c2a", color: "var(--brand)" }}
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
          {isEdit && existing && deleteBlocked && (
            <p className="text-11 text-center leading-relaxed" style={{ color: "var(--text-secondary)" }} role="status">
              {deleteBlockedLabel}
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleteOpen}
        title={t("categories.deleteTitle")}
        message={t("categories.deleteBody", { name: existing ? categoryDisplayName(existing, t) : "" })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        loading={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => { if (!deleting) setDeleteOpen(false); }}
      />
    </div>
  );
}
