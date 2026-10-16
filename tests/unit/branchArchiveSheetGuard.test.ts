/**
 * Permanent guard: the branch half of `DeleteTargetSheet` archives, and never says it erases.
 *
 * WHY THIS EXISTS
 *   The sheet called `deleteBranch`, which the database refuses: the erase behind it
 *   (`purge_branch_data`, reached through `delete_branch`) was revoked from `authenticated` in
 *   `0191_operating_branches_preserve_the_business.sql`. So the one screen whose entire purpose is
 *   to make a person read the consequence before they act was describing an erasure that could not
 *   happen, behind a button that could only fail — and it still expected a `result.deleted` payload
 *   no current RPC returns. It now archives through `archive_operating_branch` and reads what that
 *   RPC actually answers.
 *
 *   Four things could quietly bring the old behaviour back, so four things are asserted:
 *     1. the sheet reaches the archive action and no revoked one;
 *     2. it reads the payload the archive answers with (`archived`, not `deleted`/`erased`);
 *     3. every refusal the archive path can produce is answered with a key that exists in BOTH
 *        dictionaries — the dynamic `t(`${P}.key`)` shape is invisible to `i18nCoverage`, which
 *        only sees literal keys;
 *     4. no user-facing string under `branches.delete.` — EN or UR — claims records are deleted.
 *
 *   Non-vacuous by construction: put `await deleteBranch(subject.id)` back in the sheet, revert one
 *   `branches.delete.*` value to "…will be deleted", or drop the `errNotFound` entry from either
 *   dictionary, and this file fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { translations } from '../../src/lib/i18n';

const SHEET = 'src/components/shop/DeleteTargetSheet.tsx';
const STORE = 'src/stores/shopStore.ts';

function read(file: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
}

/**
 * Comments out of the way, so a doc comment that *names* the revoked RPCs as history (the store
 * explains what it removed and why) is not read as a call to them. String-aware, because a
 * `//` inside a string is not a comment.
 */
function stripComments(source: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (quote) {
      out += char;
      if (char === '\\') { out += next ?? ''; i++; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; out += char; continue; }
    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i++;
      out += ' ';
      continue;
    }
    out += char;
  }
  return out;
}

const en = translations.en as Record<string, string>;
const ur = translations.ur as Record<string, string>;
const sheetSource = read(SHEET);
const sheetCode = stripComments(sheetSource);
const storeCode = stripComments(read(STORE));

/** The two subjects the one sheet serves. */
const PREFIXES = ['branches.delete', 'account.delete'] as const;

describe('DeleteTargetSheet — the branch half archives, and says so', () => {
  it('reaches the archive action and no revoked erase', () => {
    // The revoked path, by name, in the file that used to call it.
    expect(sheetCode, 'the sheet calls the refused legacy delete').not.toMatch(/\bdeleteBranch\s*\(/);
    for (const revoked of ['delete_branch', 'purge_branch_data', 'purge_shop_data']) {
      expect(sheetCode, `the sheet reaches ${revoked}`).not.toContain(revoked);
    }

    expect(sheetCode, 'the sheet no longer archives').toMatch(/await archiveBranch\(subject\.id, archiveReason\)/);
    expect(sheetCode, 'the confirm step does not require a reason from a branch').toMatch(/disabled=\{!isAccount && !reason\}/);
    // The reason the branch history records is the picked reason plus the person's own words.
    expect(sheetCode).toMatch(/const archiveReason = \[reason \? t\(reason\) : "", feedback\.trim\(\)\]/);
  });

  it('reads the payload the archive RPC actually answers with', () => {
    // `archive_operating_branch` returns `success` + `fallback_branch_id`; the store turns that
    // into `{ ok, archived: { name, fallbackName } }`. The sheet must read that shape.
    expect(sheetCode, 'the sheet reads a payload no RPC returns').not.toMatch(/result\.(deleted|erased)\b/);
    expect(storeCode, 'the store still offers an erased/deleted payload').not.toMatch(/\.(deleted|erased)\b/);

    expect(sheetCode).toMatch(/if \(!result\.ok \|\| !result\.archived\)/);
    expect(sheetCode).toMatch(/setDone\(\{ name: result\.archived\.name, fallbackName: result\.archived\.fallbackName \}\)/);
    // The success screen names the branch that closed and the branch the account landed in.
    expect(storeCode).toMatch(/return \{ ok: true, archived: \{ name: archivedName, fallbackName \} \}/);
    expect(storeCode).toMatch(/rpc\("archive_operating_branch"/);

    // The legacy name is kept ONLY as a refusal, so a straggler call cannot reach a purge.
    expect(storeCode, 'the legacy delete is no longer a refusal').toMatch(
      /deleteBranch: async \(\) => \(\{ ok: false, code: "denied" \}\)/,
    );
  });

  it('answers every refusal the archive path can produce with an existing key in both languages', () => {
    // The codes `branchCodeFrom` can return for an archive, each of which the database really
    // raises (MAIN_BRANCH, LAST_BRANCH, BRANCH_HAS_STAFF, BRANCH_NOT_FOUND, NOT_AUTHORIZED,
    // NOT_AUTHENTICATED). A missing one is not a crash: it renders the raw key to a shop owner.
    for (const code of ['main_branch', 'last_branch', 'has_staff', 'not_found', 'denied', 'not_authenticated']) {
      expect(sheetCode, `no case for the "${code}" refusal`).toContain(`case "${code}"`);
    }
    // Silence is the one wrong answer to an unrecognised failure.
    expect(sheetCode, 'an unknown failure has no fallback message').toMatch(/default: return t\(`\$\{P\}\.failed`\)/);

    const handled = ['branches.delete.errMain', 'branches.delete.errLast', 'branches.delete.errStaff',
      'branches.delete.errNotFound', 'account.delete.errDenied', 'account.delete.errAuth',
      'account.delete.failed', 'branches.delete.errDenied', 'branches.delete.errAuth', 'branches.delete.failed'];
    for (const key of handled) {
      expect(en[key], `missing EN text for ${key}`).toBeTruthy();
      expect(ur[key], `missing UR text for ${key}`).toBeTruthy();
    }
  });

  it('uses only keys that exist, for every subject it serves', () => {
    // Every `${P}.key` the sheet renders, resolved against BOTH subjects. `i18nCoverage` cannot
    // see these — it reads literal `t("...")` calls only — which is exactly how a rename here
    // ships as `account.delete.something` printed on a shop owner's screen.
    const dynamic = [...sheetCode.matchAll(/t\(`\$\{P\}\.([A-Za-z0-9_]+)`/g)]
      .map((m) => m[1])
      .filter((value, index, all) => all.indexOf(value) === index);
    expect(dynamic.length, 'the sheet renders no dynamic keys — this guard has drifted').toBeGreaterThan(15);

    for (const key of dynamic) {
      for (const prefix of PREFIXES) {
        expect(en[`${prefix}.${key}`], `missing EN text for ${prefix}.${key}`).toBeTruthy();
        expect(ur[`${prefix}.${key}`], `missing UR text for ${prefix}.${key}`).toBeTruthy();
      }
    }

    // The literal keys as well, and the reasons the branch history records.
    const literals = [...sheetCode.matchAll(/\bt\((["'])([A-Za-z0-9_.]+)\1/g)].map((m) => m[2]);
    for (const key of [...literals, 'branches.delete.reasonOpened', 'branches.delete.reasonTemp',
      'branches.delete.reasonNeeded', 'branches.delete.reasonCost', 'branches.delete.reasonTrouble',
      'branches.delete.reasonOther']) {
      expect(en[key], `missing EN text for ${key}`).toBeTruthy();
      expect(ur[key], `missing UR text for ${key}`).toBeTruthy();
    }
  });

  it('never tells the person a branch will be deleted — EN or UR', () => {
    // The whole `branches.delete.` namespace is copy about one act. If any string in it claims
    // records are deleted, the screen is lying about what the database does.
    const EN_ERASURE = /\b(delete|deletes|deleted|deleting|erase|erases|erased|erasing|removed?|destroys?|destroyed|purge|purging|wiped?|permanently)\b/i;
    // "حذف" (delete/erase) and "مٹ" (wipe). "ختم" is deliberately NOT banned: access ending is
    // what archiving does, and the copy says so.
    const UR_ERASURE = ['حذف', 'مٹ'];

    const branchKeys = Object.keys(en).filter((key) => key.startsWith('branches.delete.'));
    expect(branchKeys.length, 'the branch copy has gone missing').toBeGreaterThan(30);

    for (const key of branchKeys) {
      expect(en[key], `${key} claims data is deleted`).not.toMatch(EN_ERASURE);
      for (const token of UR_ERASURE) {
        expect(ur[key], `${key} claims data is deleted (${token})`).not.toContain(token);
      }
    }

    // The label that OPENS the flow has to make the same promise the sheet keeps. The Settings
    // row is what reaches the sheet's branch half, and it used to read "Erase this branch and
    // everything in it" — a claim the archive refutes the moment it runs. Whatever key that row
    // uses (the branch page's wording once branch removal is routed there, this sheet's before
    // that) has to say what actually happens.
    const settings = stripComments(
      fs.readFileSync(path.resolve(process.cwd(), 'src/pages/admin/settings/AdminSettingsPage.tsx'), 'utf8'),
    );
    const marked = settings.indexOf('testId="settings-delete-branch"');
    expect(marked, 'the destructible branch row is gone from Settings').toBeGreaterThan(-1);
    const row = settings.slice(marked, settings.indexOf('/>', marked));
    const rowKeys = [...row.matchAll(/t\("([A-Za-z0-9_.]+)"\)/g)].map((m) => m[1]);
    expect(rowKeys.length, 'the destructive branch row renders no translated label').toBeGreaterThan(0);
    for (const key of rowKeys) {
      expect(en[key], `missing EN text for ${key}`).toBeTruthy();
      expect(ur[key], `missing UR text for ${key}`).toBeTruthy();
      expect(en[key], `${key} claims the branch is deleted`).not.toMatch(EN_ERASURE);
      for (const token of UR_ERASURE) {
        expect(ur[key], `${key} claims the branch is deleted (${token})`).not.toContain(token);
      }
    }
  });

  it('still tells the whole truth about the account, which is deleted', () => {
    // The fix must not have softened the other subject: closing an account really does erase.
    expect(en['account.delete.understand']).toMatch(/eras/i);
    expect(ur['account.delete.understand']).toContain('مٹ');
    expect(en['account.delete.loseTitle']).toMatch(/lose/i);

    // And the branch acknowledgement is about the branch closing, naming the branch itself.
    expect(en['branches.delete.understand']).toMatch(/archive|stop accepting/i);
    expect(en['branches.delete.step1Title']).toContain('{branch}');
    expect(ur['branches.delete.step1Title']).toContain('{branch}');
    expect(en['branches.delete.step4Title']).toMatch(/archived/);
    expect(ur['branches.delete.step4Title']).toContain('بند');
  });
});
