#!/usr/bin/env node
/**
 * state.mjs — the live checkpoint, inside ENGINEERING_OS_STATE.md.
 *
 * WHY THIS EXISTS
 *   A restarted session used to re-derive its own context (branch, what is
 *   verified, which server mode is up, what to do next) by re-reading files and
 *   re-running typecheck/inspection. Measured cost: minutes per restart, every
 *   restart. One machine-written block in the project state doc turns that into a
 *   single read.
 *
 * Usage:
 *   node scripts/dev/state.mjs resume
 *   node scripts/dev/state.mjs checkpoint [--next "command"] [--note "text"]
 */
import {
  QA_PORT, currentBranch, currentHead, dirtyFiles, git, readState,
  seconds, serverProbe, updateState, upstream,
} from './lib.mjs';

const [cmd = 'resume'] = process.argv.slice(2);

function flag(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : (process.argv[i + 1] ?? '');
}

function laneTable(lanes) {
  const entries = Object.entries(lanes || {});
  if (!entries.length) return '  (none recorded)';
  return entries
    .map(([name, v]) => `  ${v.status === 'pass' ? 'GREEN' : 'RED  '} ${name.padEnd(22)} ${v.hash?.slice(0, 8) ?? '--------'}  ${v.at ?? ''}`)
    .join('\n');
}

async function resume() {
  const st = readState();
  const branch = currentBranch();
  const head = currentHead();
  const dirty = dirtyFiles();
  const up = upstream();
  const server = await serverProbe(QA_PORT);
  const ahead = git(['rev-list', '--count', `${up}..HEAD`]);
  const behind = git(['rev-list', '--count', `HEAD..${up}`]);

  const stale = st.head && head && st.head !== head;

  console.log('═══ ENGINEERING OS — resume');
  console.log(`branch   : ${branch}${up ? `  (upstream ${up}, ahead ${ahead.out || '?'}, behind ${behind.out || '?'})` : '  (no upstream)'}`);
  console.log(`HEAD     : ${head || '(unknown)'}${stale ? `   ⚠ checkpoint was written at ${String(st.head).slice(0, 8)}` : ''}`);
  console.log(`worktree : ${dirty.length} file(s) changed${dirty.length ? ' — ' + dirty.slice(0, 8).join(', ') + (dirty.length > 8 ? `, +${dirty.length - 8} more` : '') : ''}`);
  console.log(`server   : ${server.up ? (server.problem ? `UP on ${server.port} but NOT this app's QA server (${server.problem})` : `UP on ${server.port} · QA verified (project ${server.identity?.projectId})`) : `DOWN (start: npx vite --mode qa --host 0.0.0.0 --port ${QA_PORT})`}`);
  console.log(`checkpoint: ${st.updatedAt ? `written ${st.updatedAt}` : '(none yet — run: npm run checkpoint)'}`);
  if (st.verified?.at) {
    console.log(`verified : head ${String(st.verified.head).slice(0, 8)} at ${st.verified.at} · tree ${st.verified.treeHash}`);
  }
  if (st.lastVerify) {
    const lv = st.lastVerify;
    console.log(`last gate: tier ${lv.tier} · ${String(lv.result).toUpperCase()} · ${seconds(lv.seconds || 0)} · ran ${lv.ran?.length ?? 0}, skipped ${lv.skipped?.length ?? 0}`);
  }
  console.log('lanes:');
  console.log(laneTable(st.lanes));
  if (st.nextCommand) console.log(`\nNEXT     : ${st.nextCommand}`);
  if (st.note) console.log(`NOTE     : ${st.note}`);
  const metrics = (st.metrics || []).slice(-3).reverse();
  if (metrics.length) {
    console.log('\nrecent gates:');
    for (const m of metrics) console.log(`  tier ${m.tier} ${m.result.padEnd(5)} ${String(m.seconds).padStart(4)}s  runs ${m.runs} skips ${m.skips}  ${m.at}`);
  }
}

async function checkpoint() {
  const branch = currentBranch();
  const head = currentHead();
  const dirty = dirtyFiles();
  const server = await serverProbe(QA_PORT);
  const next = updateState({
    branch,
    head,
    server: {
      port: server.port,
      up: server.up,
      mode: server.mode,
      // `verified` is the part that matters: a listening port can be a foreign application.
      verified: Boolean(server.up && !server.problem),
      projectId: server.identity?.projectId ?? null,
    },
    dirty: dirty.length,
    nextCommand: flag('next') ?? readState().nextCommand,
    note: flag('note') ?? readState().note,
  });
  console.log(`checkpoint written → ${branch} ${String(head).slice(0, 8)} · ${dirty.length} changed · server ${server.up ? `up (${server.mode ?? 'unknown mode'})` : 'down'} · ${next.updatedAt}`);
}

if (cmd === 'resume') await resume();
else if (cmd === 'checkpoint') await checkpoint();
else {
  console.error(`unknown command "${cmd}" — use: resume | checkpoint`);
  process.exit(1);
}
