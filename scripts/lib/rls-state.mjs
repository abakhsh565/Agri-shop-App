/**
 * rls-state.mjs — the row-level-security state a backup must reproduce, not assume.
 *
 * THE DEFECT THIS CLOSES
 *   The backup generator emitted `alter table public.<t> enable row level security;` for every
 *   table, whatever the live database said. Every table in production happened to have RLS on, so
 *   the assumption was invisible — until `0315` added `public.login_bridge`, a server-only switch
 *   with no policies and no table grants for `anon`/`authenticated`. Turning RLS on there would be
 *   the deny-all defect this repository has already been bitten by; turning it off is correct, and
 *   safe precisely because no client role holds a privilege on the table.
 *
 *   With RLS off in production and the artifact forcing it on, the restored copy no longer matched
 *   the source: restore verification failed on `login_bridge.enabled` and the whole gate stopped
 *   accepting backups. The artifact must reproduce the state it found.
 */

/** `alter table public."<relname>" enable|disable row level security;` */
export function rlsStatement(relname, enabled) {
  const quoted = `"${String(relname).replace(/"/g, '""')}"`;
  return `alter table public.${quoted} ${enabled ? 'enable' : 'disable'} row level security;`;
}

/** Counts for the manifest: how many tables had RLS on, and which had it off. */
export function rlsTotals(rows) {
  const enabled = rows.filter((row) => row.relrowsecurity);
  const disabled = rows.filter((row) => !row.relrowsecurity);
  return {
    enabled: enabled.length,
    disabled: disabled.length,
    disabledTables: disabled.map((row) => row.relname).sort(),
  };
}
