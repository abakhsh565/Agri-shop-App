/**
 * EN / UR translation parity guard.
 *
 * RTL + Urdu is a permanent product requirement, so a key that exists only in
 * English silently ships English copy into the Urdu UI. This test fails the
 * build when the two maps drift apart, and reports the exact keys.
 */
import { describe, it, expect } from 'vitest';
import { translations } from '@/lib/i18n';

const en = translations.en as Record<string, string>;
const ur = translations.ur as Record<string, string>;

describe('i18n parity: English and Urdu stay synchronized', () => {
  it('has exactly the same key set in both languages', () => {
    const missingInUr = Object.keys(en).filter((k) => !(k in ur));
    const missingInEn = Object.keys(ur).filter((k) => !(k in en));
    expect(missingInUr, `keys missing from Urdu: ${missingInUr.join(', ')}`).toEqual([]);
    expect(missingInEn, `keys missing from English: ${missingInEn.join(', ')}`).toEqual([]);
  });

  it('translates the owner-facing access vocabulary', () => {
    // The groups a shop owner reads on the employee/role screens.
    const groups = ['area.', 'action.', 'empDetail.', 'empList.', 'roles.', 'addEmployee.'];
    const untranslated: string[] = [];
    for (const [key, value] of Object.entries(en)) {
      if (!groups.some((g) => key.startsWith(g))) continue;
      if (!ur[key]) { untranslated.push(`${key} (missing)`); continue; }
      // Identical strings are only acceptable when they carry no prose (e.g. "Rs.").
      if (ur[key] === value && /[A-Za-z]{3}/.test(value)) untranslated.push(`${key} = "${value}"`);
    }
    expect(untranslated, `not translated into Urdu: ${untranslated.join(', ')}`).toEqual([]);
  });

  it('keeps placeholders identical across languages', () => {
    const placeholders = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(',');
    const drifted = Object.keys(en).filter((k) => k in ur && placeholders(en[k]) !== placeholders(ur[k]));
    expect(drifted, `placeholder mismatch: ${drifted.join(', ')}`).toEqual([]);
  });
});
