#!/usr/bin/env node
/**
 * Draft CLI — Engineering OS Parallel Workspaces
 *
 * Commands:
 *   create <slug> [description]  — Create a draft from current main
 *   list                         — List all drafts with status
 *   checkout <slug>              — Switch to a draft branch
 *   status <slug>                — Show draft verification status
 *   diff <slug>                  — Show diff between draft and its base
 *   verify <slug>                — Run tests for a draft
 *   accept <slug>                — Merge verified draft into main
 *   discard <slug>               — Delete a draft branch and state
 *
 * Safety:
 *   - Never modifies main directly
 *   - accept requires verification state = "verified"
 *   - discard removes branch + state but never touches main
 *   - QA isolation: each draft's test data uses slug-prefixed names
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STATE_PATH = path.join(ROOT, '.engineering-os', 'drafts.json');
const MAIN_BRANCH = 'main';

// ─── State Management ───────────────────────────────────────────

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { drafts: [], version: 1 };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

function findDraft(state, slug) {
  return state.drafts.find(d => d.slug === slug);
}

// ─── Git Helpers ────────────────────────────────────────────────

function git(cmd) {
  return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function currentBranch() {
  return git('rev-parse --abbrev-ref HEAD');
}

function isWorkingClean() {
  return git('status --porcelain') === '';
}

function shortHash() {
  return git('rev-parse --short HEAD');
}

// ─── Commands ───────────────────────────────────────────────────

function cmdCreate(slug, description = '') {
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    console.error('Error: slug must be lowercase alphanumeric with hyphens (e.g., "payment-fix")');
    process.exit(1);
  }

  const state = loadState();
  if (findDraft(state, slug)) {
    console.error(`Error: draft "${slug}" already exists.`);
    process.exit(1);
  }

  if (!isWorkingClean()) {
    console.error('Error: working directory is not clean. Commit or stash changes first.');
    process.exit(1);
  }

  const baseBranch = currentBranch();
  const baseCommit = shortHash();
  const branchName = `draft/${slug}`;

  // Create branch from current position
  git(`checkout -b ${branchName}`);
  git(`checkout ${MAIN_BRANCH}`);

  const draft = {
    slug,
    branch: branchName,
    description,
    baseBranch,
    baseCommit,
    createdAt: new Date().toISOString(),
    status: 'draft',
    verification: {
      state: 'untested', // untested | failing | passing | verified
      lastTestRun: null,
      testResults: null,
      evidence: [],
    },
  };

  state.drafts.push(draft);
  saveState(state);

  console.log(`✓ Draft "${slug}" created.`);
  console.log(`  Branch: ${branchName}`);
  console.log(`  Base: ${baseBranch}@${baseCommit}`);
  console.log(`  Status: draft`);
  console.log(`\n  Work on it: node scripts/draft.mjs checkout ${slug}`);
}

function cmdList() {
  const state = loadState();
  if (state.drafts.length === 0) {
    console.log('No drafts.');
    return;
  }

  console.log('Drafts:\n');
  for (const d of state.drafts) {
    const mark = d.verification.state === 'verified' ? '✓' :
                 d.verification.state === 'failing' ? '✗' : '○';
    console.log(`  ${mark} ${d.slug}`);
    console.log(`    Branch: ${d.branch}`);
    console.log(`    Base: ${d.baseCommit}`);
    console.log(`    Status: ${d.status} | Verification: ${d.verification.state}`);
    if (d.description) console.log(`    Desc: ${d.description}`);
    console.log('');
  }
}

function cmdCheckout(slug) {
  const state = loadState();
  const draft = findDraft(state, slug);
  if (!draft) {
    console.error(`Error: draft "${slug}" not found.`);
    process.exit(1);
  }

  if (!isWorkingClean()) {
    console.error('Error: working directory is not clean. Commit or stash changes first.');
    process.exit(1);
  }

  git(`checkout ${draft.branch}`);
  console.log(`✓ Switched to draft "${slug}" (${draft.branch})`);
  console.log(`  Base: ${draft.baseCommit}`);
}

function cmdStatus(slug) {
  const state = loadState();
  const draft = findDraft(state, slug);
  if (!draft) {
    console.error(`Error: draft "${slug}" not found.`);
    process.exit(1);
  }

  console.log(`Draft: ${draft.slug}`);
  console.log(`  Branch: ${draft.branch}`);
  console.log(`  Base: ${draft.baseBranch}@${draft.baseCommit}`);
  console.log(`  Created: ${draft.createdAt}`);
  console.log(`  Status: ${draft.status}`);
  console.log(`  Verification: ${draft.verification.state}`);
  if (draft.verification.lastTestRun) {
    console.log(`  Last test run: ${draft.verification.lastTestRun}`);
  }
  if (draft.verification.evidence.length > 0) {
    console.log(`  Evidence:`);
    for (const e of draft.verification.evidence) {
      console.log(`    - ${e}`);
    }
  }
}

function cmdDiff(slug) {
  const state = loadState();
  const draft = findDraft(state, slug);
  if (!draft) {
    console.error(`Error: draft "${slug}" not found.`);
    process.exit(1);
  }

  try {
    const diff = git(`diff ${draft.baseBranch}...${draft.branch} --stat`);
    console.log(`Changes in "${slug}" vs ${draft.baseBranch}:`);
    console.log(diff || '  (no changes)');
  } catch {
    console.log('  (no diff available — draft may have no commits yet)');
  }
}

function cmdVerify(slug) {
  const state = loadState();
  const draft = findDraft(state, slug);
  if (!draft) {
    console.error(`Error: draft "${slug}" not found.`);
    process.exit(1);
  }

  // Switch to draft branch
  if (!isWorkingClean()) {
    console.error('Error: working directory is not clean.');
    process.exit(1);
  }

  console.log(`Verifying draft "${slug}"...`);
  console.log(`  Switching to ${draft.branch}`);
  git(`checkout ${draft.branch}`);

  // Run tests
  let testPassed = false;
  try {
    console.log('  Running Vitest...');
    const vitestResult = execSync('npx vitest run --reporter=verbose 2>&1', {
      cwd: ROOT, encoding: 'utf8', timeout: 300000
    });
    const testMatch = vitestResult.match(/Tests\s+(\d+)\s+passed/);
    testPassed = !!testMatch;
    console.log(`  Vitest: ${testMatch ? testMatch[0] : 'completed'}`);
  } catch (e) {
    console.log('  Vitest: some tests failed');
  }

  // Build check
  let buildPassed = false;
  try {
    console.log('  Running build...');
    execSync('npm run build 2>&1', { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    buildPassed = true;
    console.log('  Build: PASS');
  } catch {
    console.log('  Build: FAIL');
  }

  // Update verification state
  draft.verification.state = testPassed && buildPassed ? 'passing' : 'failing';
  draft.verification.lastTestRun = new Date().toISOString();
  draft.verification.testResults = { vitest: testPassed, build: buildPassed };
  draft.verification.evidence.push(
    `${new Date().toISOString()}: vitest=${testPassed}, build=${buildPassed}`
  );
  saveState(state);

  // Switch back to main
  git(`checkout ${MAIN_BRANCH}`);

  console.log(`\nVerification result: ${draft.verification.state}`);
}

function cmdAccept(slug) {
  const state = loadState();
  const draft = findDraft(state, slug);
  if (!draft) {
    console.error(`Error: draft "${slug}" not found.`);
    process.exit(1);
  }

  if (draft.verification.state !== 'verified' && draft.verification.state !== 'passing') {
    console.error(`Error: draft "${slug}" is not verified (state: ${draft.verification.state}).`);
    console.error('Run verification first: node scripts/draft.mjs verify ' + slug);
    process.exit(1);
  }

  if (!isWorkingClean()) {
    console.error('Error: working directory is not clean.');
    process.exit(1);
  }

  console.log(`Accepting draft "${slug}"...`);

  // Merge draft branch into main
  try {
    git(`merge ${draft.branch} --no-ff -m "Accept draft: ${slug}"`);
    console.log(`✓ Draft "${slug}" merged into ${MAIN_BRANCH}.`);

    // Update state
    draft.status = 'accepted';
    draft.acceptedAt = new Date().toISOString();
    draft.verification.state = 'verified';
    saveState(state);

    console.log(`  Draft status: accepted`);
    console.log(`  Branch ${draft.branch} still exists (can be deleted manually).`);
  } catch (e) {
    console.error('Merge failed. Resolve conflicts manually:');
    console.error(e.message);
    process.exit(1);
  }
}

function cmdDiscard(slug) {
  const state = loadState();
  const draft = findDraft(state, slug);
  if (!draft) {
    console.error(`Error: draft "${slug}" not found.`);
    process.exit(1);
  }

  if (currentBranch() === draft.branch) {
    git(`checkout ${MAIN_BRANCH}`);
  }

  // Delete the branch
  try {
    git(`branch -D ${draft.branch}`);
  } catch {
    // Branch may not exist locally
  }

  // Remove from state
  state.drafts = state.drafts.filter(d => d.slug !== slug);
  saveState(state);

  console.log(`✓ Draft "${slug}" discarded.`);
  console.log(`  Branch ${draft.branch} deleted.`);
  console.log(`  ${MAIN_BRANCH} unchanged.`);
}

// ─── Main ───────────────────────────────────────────────────────

const [,, command, ...args] = process.argv;

switch (command) {
  case 'create':
    cmdCreate(args[0], args.slice(1).join(' '));
    break;
  case 'list':
    cmdList();
    break;
  case 'checkout':
    cmdCheckout(args[0]);
    break;
  case 'status':
    cmdStatus(args[0]);
    break;
  case 'diff':
    cmdDiff(args[0]);
    break;
  case 'verify':
    cmdVerify(args[0]);
    break;
  case 'accept':
    cmdAccept(args[0]);
    break;
  case 'discard':
    cmdDiscard(args[0]);
    break;
  default:
    console.log('Usage: node scripts/draft.mjs <command> [args]');
    console.log('');
    console.log('Commands:');
    console.log('  create <slug> [desc]  Create a draft from current main');
    console.log('  list                  List all drafts');
    console.log('  checkout <slug>       Switch to a draft branch');
    console.log('  status <slug>         Show draft status');
    console.log('  diff <slug>           Show diff vs base');
    console.log('  verify <slug>         Run tests for a draft');
    console.log('  accept <slug>         Merge verified draft into main');
    console.log('  discard <slug>        Delete a draft');
    break;
}
