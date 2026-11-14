import type { I18nKey } from "@/lib/i18n";
import type {
  CategoryClassification,
  ClassificationForm,
  ClassificationPreset,
  HandlingType,
  PhysicalFormCode,
  ResolvedClassification,
  ShopCategory,
  ShopUnit,
  UnitGroup,
} from "@/types";

/**
 * Product classification, resolved once from the category tree.
 *
 * A category either has its own profile row or inherits the nearest ancestor's. The profile
 * lists physical forms, and each form carries the unit groups a product in that form can use.
 * Nothing here knows about a particular shelf: the presets below are only starting points,
 * and the database row is what the screen reads.
 */

export const UNIT_GROUPS: UnitGroup[] = ["weight", "volume", "count"];

/**
 * The measurement families a form implies.
 *
 * The category editor no longer asks for these: a liquid is measured by volume, a powder and
 * granular product by weight, and a seed by either weight or count. Keeping the mapping here
 * means Add Product and the category editor cannot disagree about what a form means.
 */
export function unitGroupsForPhysicalForm(code: PhysicalFormCode): UnitGroup[] {
  if (code === "liquid") return ["volume"];
  if (code === "seed") return ["weight", "count"];
  if (code === "solid" || code === "unit") return ["count"];
  return ["weight"];
}

/**
 * The three measures this shop works in, and the form each one stands for.
 *
 * Category setup asks this instead of the seven physical forms: a shopkeeper knows a shelf is
 * sold by weight, by volume or by count, while "granular vs crystal" is a detail nobody should
 * have to classify before they can add a product. The form is still stored, because the rest of
 * the app reads it, but it is now derived from the answer instead of asked as a second question.
 */
export interface MeasurementFamilyOption {
  family: UnitGroup;
  form: PhysicalFormCode;
  labelKey: I18nKey;
  hintKey: I18nKey;
}

export const MEASUREMENT_FAMILIES: MeasurementFamilyOption[] = [
  { family: "weight", form: "powder", labelKey: "units.weight", hintKey: "classification.family.weightHint" },
  { family: "volume", form: "liquid", labelKey: "units.volume", hintKey: "classification.family.volumeHint" },
  { family: "count", form: "unit", labelKey: "units.count", hintKey: "classification.family.countHint" },
];

/** The stored form that represents a family, with the units that follow from it. */
export function formForFamily(family: UnitGroup): ClassificationForm {
  const option =
    MEASUREMENT_FAMILIES.find((candidate) => candidate.family === family) ??
    MEASUREMENT_FAMILIES[0];
  return { code: option.form, unitGroups: unitGroupsForPhysicalForm(option.form) };
}

/** The family a stored form belongs to. `seed` is both weight and count; it reads as weight. */
export function familyOfPhysicalForm(code: PhysicalFormCode): UnitGroup {
  const groups = unitGroupsForPhysicalForm(code);
  if (groups.includes("volume")) return "volume";
  if (groups.length === 1 && groups[0] === "count") return "count";
  return "weight";
}

/** The family's own name, so a summary never says “Powder” where it means “Weight”. */
export function familyLabelKey(family: UnitGroup): I18nKey {
  const option = MEASUREMENT_FAMILIES.find((candidate) => candidate.family === family);
  if (!option) {
    // A family without an entry is a programming error, not a label: falling back to another
    // family's English key would print "Weight" over a count, which is the one thing this
    // function exists to prevent. Fail loudly instead of guessing a translation key.
    throw new Error(`no measurement family is registered for "${family}"`);
  }
  return option.labelKey;
}

export const PHYSICAL_FORMS: { code: PhysicalFormCode; labelKey: I18nKey }[] = [
  { code: "liquid", labelKey: "classification.form.liquid" },
  { code: "powder", labelKey: "classification.form.powder" },
  { code: "granular", labelKey: "classification.form.granular" },
  { code: "crystal", labelKey: "classification.form.crystal" },
  { code: "seed", labelKey: "classification.form.seed" },
  { code: "solid", labelKey: "classification.form.solid" },
  { code: "unit", labelKey: "classification.form.unit" },
];

export const HANDLING_TYPES: { code: HandlingType; labelKey: I18nKey }[] = [
  { code: "standard", labelKey: "classification.handling.standard" },
  { code: "hazardous", labelKey: "classification.handling.hazardous" },
  { code: "cold_chain", labelKey: "classification.handling.cold_chain" },
  { code: "fragile", labelKey: "classification.handling.fragile" },
];

interface PresetDefinition {
  code: ClassificationPreset;
  labelKey: I18nKey;
  physicalForms: ClassificationForm[];
  handlingTypes: HandlingType[];
}

function form(code: PhysicalFormCode, unitGroups: UnitGroup[]): ClassificationForm {
  return { code, unitGroups };
}

export const CLASSIFICATION_PRESETS: PresetDefinition[] = [
  {
    code: "crop_protection",
    labelKey: "classification.preset.crop_protection",
    physicalForms: [
      form("liquid", ["volume"]),
      form("powder", ["weight"]),
      form("granular", ["weight"]),
      form("crystal", ["weight"]),
    ],
    handlingTypes: ["hazardous"],
  },
  {
    code: "fertilizers",
    labelKey: "classification.preset.fertilizers",
    physicalForms: [
      form("granular", ["weight"]),
      form("powder", ["weight"]),
      form("crystal", ["weight"]),
      form("liquid", ["volume"]),
    ],
    handlingTypes: ["standard"],
  },
  {
    code: "seeds",
    labelKey: "classification.preset.seeds",
    physicalForms: [
      form("seed", ["weight", "count"]),
      form("granular", ["weight"]),
      form("solid", ["count"]),
    ],
    handlingTypes: ["standard"],
  },
  {
    code: "equipment",
    labelKey: "classification.preset.equipment",
    physicalForms: [form("unit", ["count"]), form("solid", ["count"])],
    handlingTypes: ["standard"],
  },
  {
    code: "irrigation",
    labelKey: "classification.preset.irrigation",
    physicalForms: [
      form("unit", ["count"]),
      form("solid", ["count"]),
      form("liquid", ["volume"]),
    ],
    handlingTypes: ["standard"],
  },
  {
    code: "plant_nutrition",
    labelKey: "classification.preset.plant_nutrition",
    physicalForms: [
      form("liquid", ["volume"]),
      form("powder", ["weight"]),
      form("granular", ["weight"]),
      form("crystal", ["weight"]),
    ],
    handlingTypes: ["standard"],
  },
  {
    code: "general",
    labelKey: "classification.preset.general",
    physicalForms: [
      form("liquid", ["volume"]),
      form("powder", ["weight"]),
      form("granular", ["weight"]),
      form("crystal", ["weight"]),
      form("seed", ["weight", "count"]),
      form("solid", ["count"]),
      form("unit", ["count"]),
    ],
    handlingTypes: ["standard"],
  },
];

export function presetByCode(code: string): PresetDefinition | undefined {
  return CLASSIFICATION_PRESETS.find((preset) => preset.code === code);
}

export function presetLabelKey(code: string): I18nKey {
  return presetByCode(code)?.labelKey ?? presetByCode("general")!.labelKey;
}

export function physicalFormLabelKey(code: string): I18nKey {
  return (
    PHYSICAL_FORMS.find((formOption) => formOption.code === code)?.labelKey ??
    "classification.form.solid"
  );
}

export function handlingLabelKey(code: string): I18nKey {
  return (
    HANDLING_TYPES.find((handling) => handling.code === code)?.labelKey ??
    "classification.handling.standard"
  );
}

/** The measurement family a shop unit belongs to, or null for a legacy symbol. */
export function unitGroupForBaseUnit(baseUnit: string): UnitGroup | null {
  if (baseUnit === "kg") return "weight";
  if (baseUnit === "liter") return "volume";
  if (baseUnit === "piece") return "count";
  return null;
}

export function unitGroupLabelKey(group: UnitGroup): I18nKey {
  if (group === "weight") return "units.weight";
  if (group === "volume") return "units.volume";
  return "units.count";
}

/**
 * The nearest explicit profile on the category or one of its parents.
 *
 * The catalogue is one level deep today, but the walk does not assume that. A missing profile
 * row is the whole inheritance signal; the resolver never copies a parent's configuration into
 * a child.
 */
export function resolveClassification(
  categoryId: string,
  categories: ShopCategory[],
  classifications: CategoryClassification[],
): ResolvedClassification | null {
  if (!categoryId) return null;
  const byId = new Map(categories.map((category) => [category.id, category]));
  const byCategory = new Map(
    classifications.map((classification) => [classification.categoryId, classification]),
  );
  const seen = new Set<string>();
  let current = byId.get(categoryId);
  let inherited = false;

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const own = byCategory.get(current.id);
    if (own) return { ...own, sourceCategoryId: current.id, inherited };
    if (!current.parentId) break;
    current = byId.get(current.parentId);
    inherited = true;
  }

  return null;
}

/** The groups a profile exposes across all of its forms. */
export function unitGroupsOf(classification: CategoryClassification | null): UnitGroup[] {
  if (!classification) return [];
  return [...new Set(classification.physicalForms.flatMap((physicalForm) => physicalForm.unitGroups))];
}

/** The units offered for a form, or every shop unit when the form has no restriction. */
export function unitsForForm(form: ClassificationForm | null, units: ShopUnit[]): ShopUnit[] {
  if (!form || form.unitGroups.length === 0) return units;
  const allowed = new Set(form.unitGroups);
  return units.filter((unit) => {
    const group = unitGroupForBaseUnit(unit.baseUnit);
    return group ? allowed.has(group) : false;
  });
}

/**
 * The unit to open on when a form is selected.
 *
 * The seeded unit for the family wins (Kilogram / Liter / Piece); a shop that renamed it still
 * has the family, so the first unit in that family is the fallback. A unit outside the form's
 * groups is never returned.
 */
export function defaultUnitForForm(
  form: ClassificationForm | null,
  units: ShopUnit[],
): ShopUnit | undefined {
  const compatible = unitsForForm(form, units);
  if (compatible.length === 0) return undefined;
  const groups = form?.unitGroups ?? [];
  const baseForGroup: Record<UnitGroup, string> = {
    weight: "kg",
    volume: "liter",
    count: "piece",
  };
  for (const group of groups) {
    const preferred = compatible.find(
      (unit) => unit.baseUnit === baseForGroup[group] && unitGroupForBaseUnit(unit.baseUnit) === group,
    );
    if (preferred) return preferred;
  }
  return compatible[0];
}

/** A readable summary for inherited settings on the category screen. */
export function classificationSummary(
  classification: ResolvedClassification | null,
  t: (key: I18nKey) => string,
): string {
  if (!classification) return "";
  const forms = classification.physicalForms
    .map((physicalForm) => t(physicalFormLabelKey(physicalForm.code)))
    .join(" · ");
  return forms;
}
