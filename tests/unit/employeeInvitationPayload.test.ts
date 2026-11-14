/**
 * A valid Owner invitation must not be rejected because it has no per-branch role overrides.
 *
 * `payload->'branchRoles'` returns a JSON null value when the key is present with null; that is
 * not SQL NULL, and `jsonb_typeof` then reports it is not an object. The client must omit the key
 * and the server must normalize a legacy null. Both halves are guarded here because either one
 * alone lets the original INVALID_BRANCH_ROLES failure return.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const store = fs.readFileSync(path.join(ROOT, "src/stores/employeesStore.ts"), "utf8");
const migration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/0287_branch_roles_absent_is_not_invalid.sql"),
  "utf8",
);

describe("employee invitation branchRoles payload", () => {
  it("omits the key when no per-branch roles were chosen", () => {
    expect(store).not.toContain("branchRoles: input.branchRoles ?? null");
    expect(store).toContain("...(input.branchRoles ? { branchRoles: input.branchRoles } : {})");
  });

  it("treats a legacy JSON null as absent on the server", () => {
    expect(migration).toContain("NULLIF(payload->'branchRoles', 'null'::jsonb)");
    expect(migration).not.toContain("v_branch_roles jsonb := payload->'branchRoles';");
  });
});
