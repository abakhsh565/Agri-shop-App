import { describe, expect, it } from 'vitest';
import { branchIdentity, branchNameOnly } from '../../src/lib/branchKind';
import type { TranslateFn } from '../../src/lib/i18n';

/**
 * A branch is named once on a screen, never twice.
 *
 * The bug this exists for: branches provisioned by the signup flow are named after the business
 * and its kind — production's main branch is literally "Kamran Traders - Main" — while every
 * screen also draws the kind as its own word or chip. The dashboard header read
 * "Kamran Traders - Main · Main · Friday, 20 November", and the same repeat appeared on the
 * profile card, the branch list, the reports context and the employee role sheet
 * (owner, 2026-11-20: "Main main words repeating again and again on production").
 *
 * The rule: the name is printed without a kind already baked into it, and the chip is drawn only
 * when the name does not say the kind itself.
 */
const t = ((key: string) => {
  if (key === 'branches.main') return 'Main';
  if (key === 'branches.sub') return 'Sub';
  return key;
}) as TranslateFn;

describe('a branch name and its kind are printed once', () => {
  it('takes the kind out of a name that already carries it, and keeps the chip', () => {
    expect(branchIdentity(t, 'Kamran Traders - Main', true)).toEqual({
      name: 'Kamran Traders',
      kind: 'Main',
    });
    // Repeated separators and repeats from an older naming all collapse.
    expect(branchIdentity(t, 'Kamran Traders - Main - Main', true).name).toBe('Kamran Traders');
  });

  it('keeps the chip off a branch whose whole name IS the kind', () => {
    expect(branchIdentity(t, 'Main', true)).toEqual({ name: 'Main', kind: null });
    expect(branchIdentity(t, 'مرکزی', true)).toEqual({ name: 'مرکزی', kind: null });
  });

  it('leaves an ordinary name alone and still says which kind it is', () => {
    expect(branchIdentity(t, 'Gulberg', false)).toEqual({ name: 'Gulberg', kind: 'Sub' });
    expect(branchIdentity(t, 'Main Store', true)).toEqual({ name: 'Main Store', kind: 'Main' });
  });

  it('reads a kind written in either language', () => {
    expect(branchNameOnly('دکان - مرکزی')).toBe('دکان');
    expect(branchNameOnly('Kamran Traders · Main')).toBe('Kamran Traders');
  });

  it('falls back to what it was given rather than returning nothing', () => {
    expect(branchNameOnly('')).toBe('');
    expect(branchNameOnly(null)).toBe('');
    // A name that is only a separator is kept as written.
    expect(branchNameOnly(' - ')).toBe('-');
    expect(branchIdentity(t, null, null)).toEqual({ name: '', kind: null });
  });
});
