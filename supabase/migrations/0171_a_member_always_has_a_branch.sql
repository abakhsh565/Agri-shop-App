-- ═══════════════════════════════════════════════════════════════════════════════
-- 0171 — A member never has "no branches"
--
-- THE HOLE. `memberships.branch_scope` carries three states, and only two of them were
--   meant to exist:
--
--       NULL            — every branch. The explicit "All branches" choice.
--       [uuid, uuid…]   — these branches.
--       []              — NOTHING. Reachable from the employee screen: untick the last
--                         branch and the selection was saved as an empty list.
--
-- WHY NOTHING IS WORSE THAN EVERYTHING. `enforce_branch_scope()` stamps a new record
--   with `v_scope[1]` when the row states no branch, and for an empty array that is
--   NULL — the write succeeds, without a refusal and without a branch. The record then
--   belongs to no branch: a branch-limited reader filters on `branch_id = ANY(scope)`,
--   which is false for every branch, so it is invisible to the employees AND to the
--   member who wrote it — while the owner, whose scope is NULL, still sees it. Silent
--   data that nobody can find again is the worst of the three outcomes, and it is the
--   one the empty array produced.
--
-- THE RULE, at the layer that can hold it. The two screens that write a branch scope
--   (adding an employee, editing their access) now say so in words instead of saving
--   one. A CHECK constraint holds the same rule for every other writer there will ever
--   be — a script, an import, a future screen — because "the client asked nicely" is
--   not an invariant.
--
-- MEASURED BEFORE ADDING IT: `SELECT count(*) FROM memberships WHERE branch_scope IS
--   NOT NULL AND cardinality(branch_scope) = 0` returns 0 on QA, so no existing row is
--   invalidated and the constraint can be added without a backfill.
--
-- VERIFIED BY: tests/integration/branchScopeEnforcement.test.ts (the scope behaviour it
--   depends on) and the two screens' own guards; the constraint itself is exercised here
--   because a migration that cannot be applied to the real database is not a fix.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'memberships_branch_scope_not_empty'
       AND conrelid = 'public.memberships'::regclass
  ) THEN
    ALTER TABLE public.memberships
      ADD CONSTRAINT memberships_branch_scope_not_empty
      CHECK (branch_scope IS NULL OR cardinality(branch_scope) > 0);
  END IF;
END $$;

COMMENT ON COLUMN public.memberships.branch_scope IS
  'NULL = every branch in the tenant; otherwise a non-empty list of branch ids. An empty list is '
  'refused: it is not "no branches yet", it is a member whose records would be stamped without a '
  'branch and then be invisible to every branch-limited reader.';

NOTIFY pgrst, 'reload schema';
