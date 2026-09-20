/**
 * The employee access model, in one place.
 *
 * The database is authoritative (migration 0108, `get_effective_permissions`):
 *
 *     effective = (role defaults ∪ granted overrides) ∖ denied overrides
 *
 * `role_permissions` holds a role's reusable defaults; `user_permissions` holds
 * only this employee's exceptions (`is_override = true`, `is_granted` adds or
 * denies). Because defaults and exceptions are stored separately, an exception
 * survives a change of role — the role supplies the defaults, the employee keeps
 * their exceptions on top of whichever role they hold.
 *
 * Screens must render the same rule. They previously used the live resolver
 * (`effective`), which returns nothing while an invitation is still pending, and
 * they re-derived the exception set by diffing against a freshly selected role's
 * defaults — which silently discarded every exception the employee already had.
 */

/** Role defaults with this employee's exceptions applied. */
export function applyOverrides(
  defaults: Iterable<string>,
  overrides: Record<string, boolean>,
): Set<string> {
  const set = new Set(defaults);
  for (const [code, granted] of Object.entries(overrides)) {
    if (granted) set.add(code);
    else set.delete(code);
  }
  return set;
}

/**
 * The exceptions a chosen access set represents relative to the role's defaults:
 * `true` for access added for this employee, `false` for role access turned off.
 * A code equal to the role default is not an exception.
 *
 * Note the asymmetry this creates on purpose: a denial only means something
 * relative to role-derived access, so a denial whose code the new role does not
 * grant simply no longer appears here rather than being carried around as a
 * no-op row.
 */
export function diffOverrides(
  value: Iterable<string>,
  defaults: Iterable<string>,
): Record<string, boolean> {
  const current = new Set(value);
  const role = new Set(defaults);
  const overrides: Record<string, boolean> = {};
  for (const code of current) if (!role.has(code)) overrides[code] = true;
  for (const code of role) if (!current.has(code)) overrides[code] = false;
  return overrides;
}

/** How many exceptions the given set carries — the owner-facing "changed" count. */
export function overrideCount(overrides: Record<string, boolean>): number {
  return Object.keys(overrides).length;
}

/**
 * The exception rows to persist when saving: the differences the owner can see,
 * plus every stored exception that is currently a no-op for the selected role.
 *
 * Why keep the no-ops: the database treats the exception SET as independent of the
 * role (`update_employee_access` does not touch user_permissions when the role
 * changes), so changing a role must not retire decisions the owner made earlier.
 * A grant the new role happens to cover, or a denial of something the new role
 * does not grant, changes nothing about effective access — but if the role later
 * changes back, the owner's decision is still on file instead of having been
 * silently dropped. An exception that DOES change access is always taken from the
 * current edit state, so the owner's intent wins over a stale row either way.
 */
export function overridesToStore(
  value: Iterable<string>,
  defaults: Iterable<string>,
  stored: Record<string, boolean>,
): Record<string, boolean> {
  const role = new Set(defaults);
  const kept: Record<string, boolean> = {};
  for (const [code, granted] of Object.entries(stored)) {
    const isNoOp = (granted && role.has(code)) || (!granted && !role.has(code));
    if (isNoOp) kept[code] = granted;
  }
  return { ...kept, ...diffOverrides(value, role) };
}
