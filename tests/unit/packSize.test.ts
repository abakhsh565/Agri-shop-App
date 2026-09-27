/**
 * The pack size is the one number on the Add Product form that is written in two units and
 * stored in a third. These tests pin the three things that can go wrong with it:
 *
 *   1. The wrong unit offered. A Gram pack of a product sold by the liter is not a thing.
 *   2. A pack that does not round-trip — 500 Gram saved and reopened as "0.5 kg", or worse,
 *      as 0.5000000000000001, which is what `0.5 * 1000` gives on a bad day.
 *   3. A silent resize. The RPC clamp used to turn any pack below 1 into a pack of 1, so the
 *      form must never send 0 and call it a size.
 */
import { describe, it, expect } from 'vitest';
import {
  packUnitsFor,
  smallUnitFor,
  toBaseUnit,
  fromBaseUnit,
  packSizeLabel,
  packSizeSignature,
  packUnitLabelKey,
  type PackDisplayUnit,
} from '@/lib/packSize';

/** A translator that returns the English label for the unit keys this module asks for. */
const t = (key: string) =>
  ({
    'products.unit.kg': 'KG',
    'products.unit.gram': 'Gram',
    'products.unit.liter': 'Liter',
    'products.unit.ml': 'ML',
    'products.unit.piece': 'Piece',
  })[key] ?? key;

describe('the units a pack may be written in', () => {
  it('a product sold by weight offers kilos and grams', () => {
    expect(packUnitsFor('kg')).toEqual(['kg', 'gram']);
  });

  it('a product sold by volume offers liters and millilitres', () => {
    expect(packUnitsFor('liter')).toEqual(['liter', 'ml']);
  });

  it('a counted product has nothing to choose between', () => {
    expect(packUnitsFor('piece')).toEqual(['piece']);
    expect(smallUnitFor('piece')).toBeNull();
  });

  it('never offers grams to a product measured in liters', () => {
    expect(packUnitsFor('liter')).not.toContain('gram');
    expect(packUnitsFor('kg')).not.toContain('ml');
  });

  it('falls back to weight for a unit it does not recognise', () => {
    expect(packUnitsFor('furlong')).toEqual(['kg', 'gram']);
  });
});

describe('what gets stored', () => {
  it('500 Gram is half a kilo', () => {
    expect(toBaseUnit(500, 'gram')).toBe(0.5);
  });

  it('500 ML is half a liter', () => {
    expect(toBaseUnit(500, 'ml')).toBe(0.5);
  });

  it('a whole pack is itself', () => {
    expect(toBaseUnit(10, 'kg')).toBe(10);
    expect(toBaseUnit(1, 'liter')).toBe(1);
  });

  it('accepts what a text input actually holds', () => {
    expect(toBaseUnit('500', 'gram')).toBe(0.5);
    expect(toBaseUnit('2.5', 'kg')).toBe(2.5);
  });

  it('an empty or zero size becomes one, never zero', () => {
    expect(toBaseUnit('', 'kg')).toBe(1);
    expect(toBaseUnit(0, 'kg')).toBe(1);
    expect(toBaseUnit(-5, 'kg')).toBe(1);
    expect(toBaseUnit('abc', 'kg')).toBe(1);
  });
});

describe('what gets shown when a pack is reopened', () => {
  it('half a kilo reads as 500 Gram, not as 0.5', () => {
    expect(fromBaseUnit(0.5, 'kg')).toEqual({ value: 500, unit: 'gram' });
  });

  it('half a liter reads as 500 ML', () => {
    expect(fromBaseUnit(0.5, 'liter')).toEqual({ value: 500, unit: 'ml' });
  });

  it('one and above reads in the base unit', () => {
    expect(fromBaseUnit(1, 'kg')).toEqual({ value: 1, unit: 'kg' });
    expect(fromBaseUnit(2.5, 'kg')).toEqual({ value: 2.5, unit: 'kg' });
    expect(fromBaseUnit(20, 'liter')).toEqual({ value: 20, unit: 'liter' });
  });

  it('just below one still reads in the small unit', () => {
    expect(fromBaseUnit(0.999, 'kg')).toEqual({ value: 999, unit: 'gram' });
  });

  it('does not hand back float noise', () => {
    // 0.3 * 1000 is 300.00000000000006 in binary floating point.
    expect(fromBaseUnit(0.3, 'kg').value).toBe(300);
    expect(fromBaseUnit(0.29, 'kg').value).toBe(290);
    expect(fromBaseUnit(1.1, 'liter').value).toBe(1.1);
  });

  it('an unset size reads as one of the biggest unit, not as zero', () => {
    expect(fromBaseUnit(0, 'kg')).toEqual({ value: 1, unit: 'kg' });
    expect(fromBaseUnit(Number.NaN, 'kg')).toEqual({ value: 1, unit: 'kg' });
  });

  it('a counted product keeps its own unit', () => {
    expect(fromBaseUnit(1, 'piece')).toEqual({ value: 1, unit: 'piece' });
  });
});

describe('a pack survives a round trip', () => {
  const cases: Array<[number, string]> = [
    [0.5, 'kg'],
    [0.25, 'kg'],
    [0.001, 'kg'],
    [0.999, 'kg'],
    [1, 'kg'],
    [2.5, 'kg'],
    [50, 'kg'],
    [0.5, 'liter'],
    [0.75, 'liter'],
    [1, 'liter'],
    [20, 'liter'],
    [1, 'piece'],
  ];

  for (const [stored, baseUnit] of cases) {
    it(`${stored} ${baseUnit} reopens and saves back unchanged`, () => {
      const shown = fromBaseUnit(stored, baseUnit);
      const back = toBaseUnit(shown.value, shown.unit);
      expect(back).toBeCloseTo(stored, 9);
    });
  }
});

describe('the name a pack gets when the owner has not named it', () => {
  it('reads the way it is said', () => {
    expect(packSizeLabel(0.5, 'kg', t)).toBe('500 Gram');
    expect(packSizeLabel(10, 'kg', t)).toBe('10 KG');
    expect(packSizeLabel(1, 'liter', t)).toBe('1 Liter');
    expect(packSizeLabel(0.5, 'liter', t)).toBe('500 ML');
    expect(packSizeLabel(1, 'piece', t)).toBe('1 Piece');
  });

  it('never prints a decimal point on a whole number', () => {
    expect(packSizeLabel(10.0, 'kg', t)).toBe('10 KG');
    expect(packSizeLabel(1.0, 'liter', t)).toBe('1 Liter');
  });

  it('two packs of the same size produce the same name — which is the collision it exists to detect', () => {
    expect(packSizeSignature(0.5, 'kg')).toBe(packSizeSignature(500 / 1000, 'kg'));
  });

  it('and the same number in two different units does not', () => {
    expect(packSizeSignature(1, 'kg')).not.toBe(packSizeSignature(1, 'liter'));
  });
});

describe('unit labels are real translation keys', () => {
  const units: PackDisplayUnit[] = ['kg', 'gram', 'liter', 'ml', 'piece'];
  it('every unit has a label key that the translator knows', () => {
    for (const u of units) {
      const key = packUnitLabelKey(u);
      expect(key).toMatch(/^products\.unit\./);
      // The stub returns its own key when it does not recognise one, which is the failure.
      expect(t(key)).not.toBe(key);
    }
  });
});
