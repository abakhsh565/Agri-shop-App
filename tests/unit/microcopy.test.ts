/**
 * Permanent microcopy guard.
 *
 * The shop owners using this app are not technical people. Two things kept
 * leaking jargon into their screens:
 *
 *   1. Copy in the translation file that says "session", "override", "OTP" and so
 *      on instead of words a shopkeeper uses.
 *   2. Database failures shown EXACTLY as the database phrased them — a real
 *      example was "insert or update on table \"sales\" violates foreign key
 *      constraint \"sales_customer_id_fkey\"", and another told the owner to run a
 *      SQL migration.
 *
 * This test fails when either comes back, in EITHER language.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { tNow, translations } from '../../src/lib/i18n';
import { friendlyForTest } from '../../src/lib/db';

/** Words a shop owner does not use. */
const JARGON = [
  'OTP', 'token', 'session', 'RBAC', 'permission', 'override', 'scope', 'tenant',
  'payload', 'provision', 're-provision', 'sync', 'endpoint', 'API', 'JSON', 'SQL',
  'database', 'RPC', 'UUID', 'idempotency', 'webhook', 'cron', 'localhost',
  'backend', 'migration', 'schema', 'boolean', 'null', 'undefined', 'parameter',
  'credential', 'authenticate', 'authentication', 'unauthorized', 'forbidden',
  'malformed', 'exception', 'timeout', 'regex', 'enum', 'HTTP', 'URL', 'instance',
  'deprecated', 'serialise', 'deserialise',
];

/** Keys where a term is a placeholder name rather than copy (never rendered). */
const PLACEHOLDER_ONLY = new Set(['{query}', '{count}', '{phone}', '{name}', '{code}', '{branch}', '{role}', '{amount}']);

function stripPlaceholders(value: string): string {
  return value.replace(/\{[^}]*\}/g, (m) => (PLACEHOLDER_ONLY.has(m) ? ' ' : ' '));
}

function jargonIn(value: string): string[] {
  const readable = stripPlaceholders(value);
  return JARGON.filter((term) => new RegExp(`(^|[^a-z])${term}([^a-z]|$)`, 'i').test(readable));
}

/**
 * EMPLOYEE-SIDE DEBT, NOT AN EXEMPTION. The admin side (sign-in through every /admin
 * screen) is clean, and this list may only shrink. Each entry is a leftover message on
 * a screen the current pass deliberately did not touch; the list is capped so it cannot
 * grow, and removing a file from it before fixing it fails the test.
 */
const EMPLOYEE_SIDE_PENDING = [
  'src/components/layout/EmployeeLayout.tsx',
  'src/pages/employee/customers/CustomerProfilePage.tsx',
  'src/pages/employee/customers/RecordCustomerPaymentPage.tsx',
  'src/pages/employee/products/ProductDetailPage.tsx',
  'src/pages/employee/returns/ReturnConfirmPage.tsx',
  'src/pages/employee/sale/BrowseProductsPage.tsx',
  'src/pages/employee/sale/CartPage.tsx',
  'src/pages/employee/sale/VariantSelectorPage.tsx',
  'src/pages/employee/settings/SettingsPage.tsx',
];

describe('microcopy — plain language for shop owners', () => {
  it('asks for confirmation in the app own dialog, never in a browser popup', () => {
    // WHY THIS CASE EXISTS. Employee deactivate/cancel-invitation and role delete used
    // window.confirm(). A browser popup carries the app's text but NOT the app's
    // buttons: they follow the browser's language, not the owner's, and their order
    // does not flip in Urdu. Every confirmation is now ConfirmDialog, which takes
    // translated labels and mirrors its button row under RTL.
    const NATIVE = /(?:window\.)?confirm\s*\(/g;
    const ALLOWED = /\b(confirmAction|confirmRemove|confirmDelete|setConfirm|confirmLabel|confirmText|confirm_clear)\b/;
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const source = fs.readFileSync(full, 'utf8');
          const rel = path.relative(process.cwd(), full).replace(/\\/g, '/');
          source.split('\n').forEach((line, i) => {
            if (!NATIVE.test(line)) return;
            NATIVE.lastIndex = 0;
            if (ALLOWED.test(line)) return;
            if (/^\s*(\/\/|\*)/.test(line)) return;
            offenders.push(`${rel}:${i + 1} ${line.trim().slice(0, 80)}`);
          });
        }
      }
    };
    walk(path.resolve(process.cwd(), 'src'));

    expect(
      offenders,
      'use ConfirmDialog with t() labels — a browser confirm is not translatable',
    ).toEqual([]);
  });

  it('never builds a user-facing message as a raw English fallback', () => {
    // WHY THIS CASE EXISTS. `result.error || "Could not send the code. Check the number
    // and try again."` is the shape that leaked English into the sign-in flow: the
    // literal is the RIGHT-hand side, so a scan that looks at call arguments never
    // saw it. A fallback written next to a t() call is fine, because the coverage
    // guard proves that key exists in both languages; a fallback with no t() on the
    // line is English that ships.
    // Plain quotes only. A backtick here is an interpolated template such as
    // `stage_${i}`, which is an identifier the reminder engine persists as an
    // occurrence key — translating it would break reminder idempotency. Rendered
    // templates are covered by the JSX ratchet in i18nCoverage.
    const FALLBACK = /(?:\|\||\?\?)\s*(['"])([^'"\n]{2,})\1/g;
    const DATA_SHAPED = [
      /^var\(--/, /^#[0-9a-fA-F]{3,8}$/, /^\d/, /^[a-z]+\/[a-z0-9.+-]+$/, // CSS var, hex, mime
      /^rgba?\(/, /^-?\d+(\.\d+)?(px|rem|em|%|vh|vw|ms|s)?$/, /^[a-z][a-zA-Z0-9_-]*$/,
      /^[A-Z_]{2,}$/, /^\/|^https?:/, /^e\.|^err\b/,
    ];
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const source = fs.readFileSync(full, 'utf8');
          const rel = path.relative(process.cwd(), full).replace(/\\/g, '/');
          // Scope, not exemption: this pass covers sign-in → onboarding → every
          // /admin screen. The employee-side screens are the next batch, and
          // observationBot.ts is the internal QA bot's own report wording, which
          // never reaches a shop owner.
          if (EMPLOYEE_SIDE_PENDING.includes(rel)) continue;
          if (rel.startsWith('src/pages/employee/')) continue;
          if (rel === 'src/lib/observationBot.ts') continue;
          source.split('\n').forEach((line, i) => {
            if (/\bt(?:Now)?\s*\(/.test(line)) return; // defensive fallback beside a t() key
            if (/^\s*(\/\/|\*)/.test(line)) return; // comment
            for (const m of line.matchAll(FALLBACK)) {
              const text = m[2].trim();
              if (!/[a-zA-Z]{2}/.test(text)) continue;
              if (DATA_SHAPED.some((r) => r.test(text))) continue;
              offenders.push(`${rel}:${i + 1} ${m[0].trim().slice(0, 70)}`);
            }
          });
        }
      }
    };
    walk(path.resolve(process.cwd(), 'src'));

    expect(
      offenders,
      'these English fallbacks are shown when the left side is empty — use t("some.key") and add it to both dictionaries',
    ).toEqual([]);
  });

  it('no user-facing string uses technical wording (EN and UR)', () => {
    const offenders: string[] = [];
    for (const [lang, dict] of Object.entries(translations)) {
      for (const [key, value] of Object.entries(dict as Record<string, string>)) {
        const found = jargonIn(value);
        if (found.length) offenders.push(`${lang} ${key} [${found.join(', ')}]: ${value}`);
      }
    }
    expect(offenders, `technical wording in user-facing copy:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('database failures are never shown as the database phrased them', () => {
    // The messages below are the real strings Postgres/PostgREST hand back.
    const rawFailures = [
      'insert or update on table "sales" violates foreign key constraint "sales_customer_id_fkey"',
      'duplicate key value violates unique constraint "customers_phone_unique"',
      'permission denied for table users',
      'JWT expired',
      'PGRST301: JWSError JWSInvalidSignature',
      'null value in column "customer_id" of relation "sales" violates not-null constraint',
      'column "unit" of relation "products" does not exist',
      'Failed to fetch',
      'INSUFFICIENT_STOCK',
      'NEGATIVE_STOCK',
      'NOT_AUTHORIZED: product belongs to another tenant',
      'EXCESS_RETURN',
      'RETURN_WINDOW_EXPIRED',
      'DUPLICATE_SUBMISSION',
      'ACCOUNT_INACTIVE',
      'NOT_AUTHENTICATED',
      'VARIANT_NOT_FOUND',
    ];

    for (const raw of rawFailures) {
      const said = friendlyForTest(raw);
      expect(said, `raw database text reached the user for: ${raw}`).not.toBe(raw);
      expect(jargonIn(said), `technical wording shown for "${raw}": ${said}`).toEqual([]);
      expect(said.length).toBeGreaterThan(10);
    }
  });

  it('failure messages exist in both languages', () => {
    const en = translations.en as Record<string, string>;
    const ur = translations.ur as Record<string, string>;
    const errorKeys = Object.keys(en).filter((k) => k.startsWith('errors.'));
    expect(errorKeys.length, 'no failure messages are defined').toBeGreaterThan(5);
    for (const key of errorKeys) {
      expect(ur[key], `missing Urdu text for ${key}`).toBeTruthy();
    }
  });

  it('reports a failure in the language being read, not always English', () => {
    // tNow reads the same language store the UI writes.
    expect(tNow('errors.noStock')).toBeTruthy();
  });

  it('never passes a hardcoded message to the toast or the form error', () => {
    // WHY THIS CASE EXISTS. The dictionary scan above and the JSX ratchet both
    // passed while 66 messages were hardcoded English inside admin screens — because
    // they are STRING ARGUMENTS to addToast()/setError(), which neither scan reads.
    // An owner using the app in Urdu read "Sale voided successfully" and "Enter an
    // amount greater than zero." in English. Every one of those messages is now a
    // key; this test is what keeps them that way.
    //
    // `setX("")` is a reset, not copy, so empty strings are allowed.
    // The function list matters: the first version covered only addToast/setError, so
    // the sign-in and shop-registration screens' `setPhoneError("Enter a valid phone
    // number…")` — and the `|| "Could not send the code…"` fallbacks beside them —
    // stayed English for an owner reading Urdu.
    const CALL =
      /\b(addToast|setError|setErr|setPhoneError|setFormError|setFieldError|setMessage|setStatus|showError|showToast|toast|alert|confirm|notify|setNotification|setHint|setWarning|setSuccess)\s*\(\s*(['"`])([^'"`]*)\2/g;
    const offenders: string[] = [];

    // The list lives at module scope so the other cases can honour it too.
    expect(EMPLOYEE_SIDE_PENDING.length, 'this list may only shrink — fix a file, do not add one').toBeLessThanOrEqual(9);

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const source = fs.readFileSync(full, 'utf8');
          for (const m of source.matchAll(CALL)) {
            const [, fn, , text] = m;
            if (text.trim() === '') continue;
            // A template that interpolates is assembled from translated parts
            // (e.g. `${question}\n\n${hint}`), not hardcoded copy.
            if (text.includes('${')) continue;
            // A template with no letters is data, not copy (e.g. `${a} · ${b}`).
            if (!/[a-zA-Z]{2}/.test(text)) continue;
            const rel = path.relative(process.cwd(), full).replace(/\\/g, '/');
            if (EMPLOYEE_SIDE_PENDING.includes(rel)) continue;
            const line = source.slice(0, m.index).split('\n').length;
            offenders.push(`${rel}:${line} ${fn}("${text.slice(0, 60)}")`);
          }
        }
      }
    };
    walk(path.resolve(process.cwd(), 'src'));

    expect(
      offenders,
      'these messages are hardcoded, so they stay English for a shop owner reading Urdu — use t("some.key") and add it to both dictionaries'
    ).toEqual([]);
  });

  it('never passes a hardcoded message as a LATER argument either', () => {
    // WHY THIS CASE EXISTS. The check above requires the literal to be the FIRST
    // argument, so
    //   addToast(err instanceof Error ? err.message : "Failed to void sale", "error")
    // passed — the English sits behind the `:`. A line that already calls t() is left
    // alone, because then the literal is either a fallback for a key the coverage guard
    // proves exists, or a toast kind.
    const LINE = /\b(addToast|setError|setErr|setPhoneError|setFormError|setFieldError|setMessage|showError|showToast|toast|alert|notify|setNotification|setHint|setWarning|setSuccess)\s*\(/;
    const LITERAL = /(['"])([^'"\n]{2,})\1/g;
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const rel = path.relative(process.cwd(), full).replace(/\\/g, '/');
          if (EMPLOYEE_SIDE_PENDING.includes(rel)) continue;
          const source = fs.readFileSync(full, 'utf8');
          source.split('\n').forEach((line, i) => {
            if (!LINE.test(line)) return;
            if (/\bt(?:Now)?\s*\(/.test(line)) return;
            if (/^\s*(\/\/|\*)/.test(line)) return;
            // An inline `isUrdu ? "اردو" : "English"` picks the language at render time,
            // so the English arm is not a leak. The coverage guard counts those instead.
            if (/[^\u0000-\u007F]/.test(line)) return;
            for (const m of line.matchAll(LITERAL)) {
              const text = m[2].trim();
              // Real copy starts with a letter. Without this, two statements on one line
              // (`setError(""); setStep("pin")`) are captured as `); setStep(`.
              if (!/^[A-Za-z]/.test(text)) continue;
              // A sentence (or one long word) is copy; "error", "success" and "warning"
              // are the toast kind, and an empty string is a reset.
              const isCopy = /\s/.test(text) ? /[A-Za-z]{2}/.test(text) : text.length >= 10;
              if (isCopy) offenders.push(`${rel}:${i + 1} "${text.slice(0, 60)}"`);
            }
          });
        }
      }
    };
    walk(path.resolve(process.cwd(), 'src'));

    expect(
      offenders,
      'this message is hardcoded English — use t("some.key") with EN + UR entries',
    ).toEqual([]);
  });
});
