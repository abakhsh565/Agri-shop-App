import { describe, expect, it } from "vitest";
import {
  CLASSIFICATION_PRESETS,
  PHYSICAL_FORMS,
  defaultUnitForForm,
  resolveClassification,
  unitGroupsForPhysicalForm,
  unitsForForm,
  unitGroupForBaseUnit,
} from "@/lib/classification";
import type {
  CategoryClassification,
  ShopCategory,
  ShopUnit,
} from "@/types";

const shelf = (
  id: string,
  parentId: string | null,
  name: string,
): ShopCategory => ({
  id,
  parentId,
  name,
  legacyCategory: null,
  isSystem: false,
  sortOrder: 0,
});

const kilogram: ShopUnit = {
  id: "kg-unit",
  name: "Kilogram",
  symbol: "kg",
  baseUnit: "kg",
  precision: 2,
  isSystem: true,
};

const litre: ShopUnit = {
  id: "l-unit",
  name: "Litre",
  symbol: "L",
  baseUnit: "liter",
  precision: 2,
  isSystem: true,
};

const piece: ShopUnit = {
  id: "pc-unit",
  name: "Piece",
  symbol: "pc",
  baseUnit: "piece",
  precision: 0,
  isSystem: true,
};

const cropProtection: CategoryClassification = {
  categoryId: "pesticide",
  preset: "crop_protection",
  physicalForms: [
    { code: "liquid", unitGroups: ["volume"] },
    { code: "powder", unitGroups: ["weight"] },
  ],
  handlingTypes: ["hazardous"],
};

describe("category classification inheritance", () => {
  const categories = [
    shelf("pesticide", null, "Pesticide"),
    shelf("insecticide", "pesticide", "Insecticide"),
    shelf("systemic", "insecticide", "Systemic"),
    shelf("fertilizer", null, "Fertilizer"),
  ];

  it("uses an ancestor profile when the child has no row of its own", () => {
    const resolved = resolveClassification("systemic", categories, [cropProtection]);

    expect(resolved?.sourceCategoryId).toBe("pesticide");
    expect(resolved?.inherited).toBe(true);
    expect(resolved?.physicalForms.map((form) => form.code)).toEqual(["liquid", "powder"]);
  });

  it("uses the nearest explicit ancestor", () => {
    const childOverride: CategoryClassification = {
      categoryId: "insecticide",
      preset: "plant_nutrition",
      physicalForms: [{ code: "granular", unitGroups: ["weight"] }],
      handlingTypes: ["standard"],
    };

    const resolved = resolveClassification("systemic", categories, [
      cropProtection,
      childOverride,
    ]);

    expect(resolved?.sourceCategoryId).toBe("insecticide");
    expect(resolved?.preset).toBe("plant_nutrition");
    expect(resolved?.inherited).toBe(true);
  });

  it("uses an explicit child profile as an override", () => {
    const childOverride: CategoryClassification = {
      categoryId: "insecticide",
      preset: "seeds",
      physicalForms: [{ code: "seed", unitGroups: ["weight", "count"] }],
      handlingTypes: ["standard"],
    };

    const resolved = resolveClassification("insecticide", categories, [
      cropProtection,
      childOverride,
    ]);

    expect(resolved?.sourceCategoryId).toBe("insecticide");
    expect(resolved?.inherited).toBe(false);
    expect(resolved?.physicalForms[0].code).toBe("seed");
  });

  it("returns null when no category in the chain has a profile", () => {
    expect(resolveClassification("fertilizer", categories, [cropProtection])).toBeNull();
  });

  it("does not loop on malformed parent links", () => {
    const broken = [shelf("a", "b", "A"), shelf("b", "a", "B")];
    expect(resolveClassification("a", broken, [])).toBeNull();
  });
});

describe("classification unit compatibility", () => {
  const liquid = cropProtection.physicalForms[0];

  it("offers only units in the form's groups", () => {
    expect(unitsForForm(liquid, [kilogram, litre, piece]).map((unit) => unit.id)).toEqual([
      "l-unit",
    ]);
  });

  it("opens on the seeded unit for the form's family", () => {
    expect(defaultUnitForForm(liquid, [piece, kilogram, litre])?.id).toBe("l-unit");
  });

  it("maps the three supported base units", () => {
    expect(unitGroupForBaseUnit("kg")).toBe("weight");
    expect(unitGroupForBaseUnit("liter")).toBe("volume");
    expect(unitGroupForBaseUnit("piece")).toBe("count");
    expect(unitGroupForBaseUnit("ton")).toBeNull();
  });

  it("derives unit groups from a physical form", () => {
    expect(unitGroupsForPhysicalForm("liquid")).toEqual(["volume"]);
    expect(unitGroupsForPhysicalForm("seed")).toEqual(["weight", "count"]);
    expect(unitGroupsForPhysicalForm("solid")).toEqual(["count"]);
    expect(unitGroupsForPhysicalForm("unit")).toEqual(["count"]);
    expect(unitGroupsForPhysicalForm("powder")).toEqual(["weight"]);
  });

  it("keeps every preset's forms non-empty and unique", () => {
    for (const preset of CLASSIFICATION_PRESETS) {
      const codes = preset.physicalForms.map((form) => form.code);
      expect(codes.length).toBeGreaterThan(0);
      expect(new Set(codes).size).toBe(codes.length);
      for (const form of preset.physicalForms) {
        expect(PHYSICAL_FORMS.some((option) => option.code === form.code)).toBe(true);
        expect(form.unitGroups.length).toBeGreaterThan(0);
      }
    }
  });
});
