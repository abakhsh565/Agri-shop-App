import type { BaseUnit } from "@/types";
import type { I18nKey } from "@/lib/i18n";

/**
 * How big one pack is, in the two units a shopkeeper actually says out loud.
 *
 * The database stores exactly one number — `product_variants.unit_size` — always expressed
 * in the product's own base unit: `0.5` for a 500 Gram pack of a product sold by weight,
 * `0.5` for a 500 ML bottle of a product sold by volume. That is the right shape for
 * storage, and the wrong shape for a form, because nobody types `0.5` and means five
 * hundred gram.
 *
 * So the form has a number and a unit next to it, and this module is the only place the two
 * are converted. Two rules it exists to keep:
 *
 *   1. **The unit offered is decided by the product's unit.** KG gives KG and Gram, Liter
 *      gives Liter and ML. A Gram pack of a product measured in liters is not a thing.
 *   2. **A pack round-trips.** 500 Gram is stored as 0.5 and reopens as "500 Gram", never
 *      as "0.5 kg" — and never as 0.5000000000000001, which is what a naive `× 1000` on a
 *      float would eventually hand back.
 */

/** The units a pack size can be *written* in. `piece` is kept for legacy rows only. */
export type PackDisplayUnit = "kg" | "gram" | "liter" | "ml" | "piece";

/** What one of these is worth in the product's base unit. */
const FACTOR: Record<PackDisplayUnit, number> = {
  kg: 1,
  gram: 0.001,
  liter: 1,
  ml: 0.001,
  piece: 1,
};

const LABEL_KEY: Record<PackDisplayUnit, I18nKey> = {
  kg: "products.unit.kg",
  gram: "products.unit.gram",
  liter: "products.unit.liter",
  ml: "products.unit.ml",
  piece: "products.unit.piece",
};

/** Small unit first-mention order matters: index 0 is the big one, index 1 the small one. */
const UNITS_FOR: Record<string, PackDisplayUnit[]> = {
  kg: ["kg", "gram"],
  liter: ["liter", "ml"],
  // A counted product has one unit and nothing to choose between.
  piece: ["piece"],
};

/** The units a pack of this product may be written in, biggest first. */
export function packUnitsFor(baseUnit: string): PackDisplayUnit[] {
  return UNITS_FOR[baseUnit] ?? UNITS_FOR.kg;
}

/** The small companion unit, when there is one — Gram for KG, ML for Liter. */
export function smallUnitFor(baseUnit: string): PackDisplayUnit | null {
  const units = packUnitsFor(baseUnit);
  return units.length > 1 ? units[1] : null;
}

export function packUnitLabelKey(unit: PackDisplayUnit): I18nKey {
  return LABEL_KEY[unit];
}

/** Kills float noise without touching a value that was already clean. */
function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/**
 * What to store when the owner typed `value` in `unit`.
 *
 * Empty or unparseable reads as 1 — the same fallback the database applies — so a pack can
 * never be saved as zero-sized and disappear from every "per pack" calculation.
 */
export function toBaseUnit(value: number | string, unit: PackDisplayUnit): number {
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return 1;
  return round(n * FACTOR[unit], 6);
}

export interface PackSizeDisplay {
  /** The number to put in the box. */
  value: number;
  /** The unit to select beside it. */
  unit: PackDisplayUnit;
}

/**
 * What to show when reopening a pack that was stored as `size`.
 *
 * Anything smaller than one whole base unit is shown in the small unit, because that is how
 * it was entered and how it is said: 0.5 kg is "500 Gram". At or above one, the base unit is
 * used as-is.
 */
export function fromBaseUnit(size: number, baseUnit: string): PackSizeDisplay {
  const units = packUnitsFor(baseUnit);
  const big = units[0];
  const small = units.length > 1 ? units[1] : null;

  if (!Number.isFinite(size) || size <= 0) return { value: 1, unit: big };
  if (small && size < 1) return { value: round(size / FACTOR[small], 4), unit: small };
  return { value: round(size, 4), unit: big };
}

/**
 * "500 Gram", "10 KG", "1 Liter" — the name a pack gets when the owner has not named it.
 *
 * It is not only a label: `product_variants.name` is what appears on receipts, on sale
 * lines and in the pack picker, and it is NOT NULL, so something has to fill it.
 */
export function packSizeLabel(
  size: number,
  baseUnit: string,
  t: (key: I18nKey) => string
): string {
  const { value, unit } = fromBaseUnit(size, baseUnit);
  const shown = Number.isInteger(value) ? String(value) : String(round(value, 4));
  return `${shown} ${t(packUnitLabelKey(unit))}`;
}

/** The same reading, without the translator — for comparing two packs' names. */
export function packSizeSignature(size: number, baseUnit: string): string {
  const { value, unit } = fromBaseUnit(size, baseUnit);
  return `${round(value, 4)}${unit}`;
}
