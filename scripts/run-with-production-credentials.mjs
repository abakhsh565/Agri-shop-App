#!/usr/bin/env node
/**
 * run-with-production-credentials.mjs — hand production credentials to ONE allow-listed local run.
 *
 *   node scripts/run-with-production-credentials.mjs --init
 *   node scripts/run-with-production-credentials.mjs --check
 *   node scripts/run-with-production-credentials.mjs -- node scripts/backup-database.mjs --env production
 *   node scripts/run-with-production-credentials.mjs -- node scripts/restore-verify.mjs \
 *        --from backups/<artifact>.manifest.json --compare-with production
 *
 * Why a wrapper instead of `export PROD_DB_PASS=...`
 *   The export works, and is what `docs/RECOVERY.md` documented first. It has two problems on a
 *   machine an agent and a human share: the value ends up in a shell's history file, and it ends up
 *   in the environment of every LATER process in that shell, including builds and test runs that
 *   have no business seeing a production password. This wrapper loads the value once, checks the
 *   file, injects the values into exactly one child process, and exits.
 *
 * What it refuses
 *   1. A credentials file inside the repository (see scripts/lib/credentials-file.mjs).
 *   2. An incomplete file, or one whose PROD_DB_USER does not name the production project — the
 *      same guard the backup path uses, imported rather than reimplemented.
 *   3. Any command other than the two that read production and write nothing: the backup and the
 *      restore verifier. A credential injector that will run anything is a credential leak with a
 *      polite interface.
 *   4. A run that does not name production in its own arguments (`--env production`,
 *      `--compare-with production`), so the wrapper can never be used to smuggle credentials into
 *      an unrelated command.
 *
 * What it never does
 *   Print, log, hash or echo the password. The summary names the file, the host, the user string
 *   and the fact that a password was loaded — never the value. `npm run verify:credentials` asserts
 *   that with a fresh canary on every run.
 *
 * Exit codes: 0 = child succeeded, 2 = refused before spawning, otherwise the child's own code.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { ROOT } from './lib/environments.mjs';
import {
  CREDENTIAL_KEYS,
  defaultCredentialsPath,
  readCredentialsFile,
  validateProductionCredentials,
  writeCredentialsTemplate,
} from './lib/credentials-file.mjs';

const args = process.argv.slice(2);

/**
 * The only commands a production credential may be handed to. All three are read-only on production:
 *
 *   backup-database   reads every row and writes a LOCAL artifact
 *   restore-verify    reads the artifact and compares it with production
 *   measure-production-acls  reads `pg_class` / `pg_policy` / `pg_proc` inside a READ ONLY
 *                     transaction and prints what `anon` and `authenticated` actually hold
 *
 * The last one was added because the question it answers had never been measured: the baseline
 * artifact carries no GRANT at all, so no rehearsal can say what production already grants. Adding it
 * does not widen what the credential can do — it is a third reader, and every other command is still
 * refused before a credential is read (`npm run verify:credentials` asserts that with a canary).
 */
const ALLOWED_SCRIPTS = [
  'scripts/backup-database.mjs',
  'scripts/restore-verify.mjs',
  'scripts/measure-production-acls.mjs',
].map((p) => path.join(ROOT, p));

function flag(name, fallback = null) {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return fallback;
  const token = args[i];
  return token.includes('=') ? token.slice(token.indexOf('=') + 1) : args[i + 1] ?? fallback;
}

function refuse(message) {
  console.error(message);
  process.exit(2);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(
    [
      'Usage: node scripts/run-with-production-credentials.mjs [--file <path>] <mode>',
      '',
      '  --init                 write the credential template (never overwrites an existing file)',
      '  --check                validate the file and report what was loaded, then stop',
      '  -- <command> [args]    run one allow-listed command with the values in its environment',
      '',
      `  Default credential file: ${defaultCredentialsPath()}`,
      `  Allowed commands: ${ALLOWED_SCRIPTS.map((p) => path.relative(ROOT, p)).join(', ')}`,
      '',
      '  The file must live outside this repository; a path inside it is refused, not warned about.',
    ].join('\n'),
  );
  process.exit(0);
}

const filePath = path.resolve(flag('file', defaultCredentialsPath()));

// ── --init: create the template, never clobber a filled-in one ────────────────────────────────
if (args.includes('--init')) {
  try {
    const created = writeCredentialsTemplate(filePath);
    console.log(`Created ${created}`);
    console.log('');
    console.log('Next: replace the empty PROD_DB_PASS line with the production database password.');
    console.log('      Supabase dashboard -> production project -> Settings -> Database.');
    console.log('      Then run:  node scripts/run-with-production-credentials.mjs --check');
  } catch (error) {
    refuse(String(error.message));
  }
  process.exit(0);
}

// ── Load and validate, always before anything is spawned ─────────────────────────────────────
let values;
let info;
try {
  ({ values } = readCredentialsFile(filePath, { requireAll: false }));
  // ONE call site, and the rule lives in the shared guard. `npm run verify:credentials` proves this
  // line is load-bearing by deleting it in a throwaway copy and watching a wrong-project file
  // become acceptable.
  info = validateProductionCredentials(values, { source: filePath });
} catch (error) {
  refuse(String(error.message));
}

console.error(`[CREDS] file : ${filePath} (outside the repository)`);
console.error(`[CREDS] host : ${info.host}`);
console.error(`[CREDS] user : ${info.user}`);
console.error('[CREDS] pass : loaded, value withheld');
if (info.extras?.length) {
  console.error(`[CREDS] note : ignoring unrecognised key(s) ${info.extras.join(', ')}`);
}

if (args.includes('--check')) {
  console.log(`OK — ${CREDENTIAL_KEYS.length} keys loaded, PROD_DB_USER names production (${info.projectRef}).`);
  console.log('No connection was attempted: --check proves the file, not the database.');
  process.exit(0);
}

// ── The command, and why only these ──────────────────────────────────────────────────────────
const separator = args.indexOf('--');
if (separator === -1 || separator === args.length - 1) {
  refuse(
    '[CREDENTIAL INTAKE REFUSED] No command given. Use:\n' +
      '  node scripts/run-with-production-credentials.mjs -- node scripts/backup-database.mjs --env production',
  );
}

const command = args.slice(separator + 1);
const [runtime, script, ...rest] = command;
const runtimeBase = path.basename(runtime ?? '').toLowerCase();

if (runtimeBase !== 'node' && runtimeBase !== 'node.exe' && path.resolve(runtime ?? '') !== process.execPath) {
  refuse(`[CREDENTIAL INTAKE REFUSED] Only "node" may be launched with production credentials. Got "${runtime}".`);
}

const resolvedScript = path.resolve(ROOT, script ?? '');
if (!ALLOWED_SCRIPTS.includes(resolvedScript)) {
  refuse(
    `[CREDENTIAL INTAKE REFUSED] "${script}" is not on the allow-list. Production credentials are ` +
      `handed only to the commands that read production and write nothing:\n` +
      `  ${ALLOWED_SCRIPTS.map((p) => path.relative(ROOT, p)).join('\n  ')}\n` +
      `  An injector that runs anything is a credential leak with a polite interface.`,
  );
}

if (!rest.includes('production') || !rest.some((a) => a === '--env' || a === '--compare-with')) {
  refuse(
    `[CREDENTIAL INTAKE REFUSED] The command must name production itself, as ` +
      `\`--env production\` or \`--compare-with production\`. Got: ${rest.join(' ') || '(nothing)'}`,
  );
}

const childEnv = { ...process.env, ...Object.fromEntries(CREDENTIAL_KEYS.map((key) => [key, values[key]])) };
console.error(`[CREDS] running: node ${path.relative(ROOT, resolvedScript)} ${rest.join(' ')}`);

const child = spawnSync(process.execPath, [resolvedScript, ...rest], {
  cwd: ROOT,
  env: childEnv,
  stdio: 'inherit',
});

if (child.error) {
  console.error(`[CREDS] could not start the child: ${child.error.message}`);
  process.exit(1);
}

const code = child.status ?? 1;
console.error(`[CREDS] child exited ${code}${child.signal ? ` (signal ${child.signal})` : ''}`);
process.exit(code);
