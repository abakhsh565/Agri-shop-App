/**
 * Permanent guard: an access read that has not answered is not an answer.
 *
 * The owner asked, looking at the Add Employee flow, "where is checkbox design". It was there —
 * but three separate ways of not knowing had been rendered as knowledge:
 *
 *   1. `getRolePermissions` answers `[]` for a role that grants nothing *and* for a request
 *      that never succeeded, so the editor drew forty unticked boxes after a failed read.
 *   2. Every editor opened before its read landed, so the first frame was the same forty
 *      unticked boxes — enough to make an owner believe a role carries no access, and enough
 *      to save that belief onto a real employee.
 *   3. The permission catalogue loads separately, so a checklist opened early rendered *no*
 *      rows at all, which reads as "this feature is missing".
 *
 * Only the first is a data bug; the other two are the same mistake in the presentation — an
 * unknown state drawn as an empty one. The fix is a read that reports failure
 * (`loadRolePermissions`) and a rendered state that admits it is still waiting.
 *
 * Two assertions:
 *   1. Behavioural — the reporting read returns a non-null error when the request fails, so
 *      "the read failed" is never again indistinguishable from "nothing is granted".
 *   2. Structural — every screen that renders an access checklist takes its grants from the
 *      reporting read and has a state for "not known yet", so a future screen cannot quietly
 *      reintroduce the silent one.
 *
 * If this fails, fix the screen. Do not delete the check.
 */
import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

const env = vi.hoisted(() => ({ fail: false }));

vi.mock("@/lib/supabase", () => ({
  supabaseUrl: "https://qa.supabase.co",
  supabase: {
    from: () => ({
      select: () => ({
        eq: async () =>
          env.fail
            ? { data: null, error: { message: "permission denied for table role_permissions" } }
            : { data: [{ permissions: { code: "sales.view" } }, { permissions: { code: "sales.create" } }], error: null },
      }),
    }),
  },
}));

import { useRolesStore } from "@/stores/rolesStore";

const SRC = path.resolve(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const read = (abs: string) => fs.readFileSync(abs, "utf8");
const rel = (abs: string) => path.relative(process.cwd(), abs).split(path.sep).join("/");

/**
 * The one place the silent read is still legitimate: the roles *list* uses it to name the areas
 * a role opens, in a summary row. A failed read there loses a decorative label, never a grant,
 * and it is never what an editor opens on.
 */
const SILENT_READ_ALLOWED = new Map<string, string>([
  ["src/pages/admin/settings/RolesAccessPage.tsx", "names the areas a role opens in a list row, never the editor's grants"],
]);

describe("Access reads", () => {
  it("reports a failed read instead of answering 'no access'", async () => {
    env.fail = false;
    const ok = await useRolesStore.getState().loadRolePermissions("role-1");
    expect(ok.error).toBeNull();
    expect(ok.codes).toEqual(["sales.view", "sales.create"]);

    env.fail = true;
    const failed = await useRolesStore.getState().loadRolePermissions("role-1");
    // The whole point: a failure is reported, and is not the same value as an empty grant.
    expect(failed.error).toBeTruthy();
    expect(failed.codes).toEqual([]);

    // And the old read, kept for the summary above, still cannot tell those apart — which is
    // exactly why an editor must not open on it.
    expect(await useRolesStore.getState().getRolePermissions("role-1")).toEqual([]);
  });

  it("no screen opens an access checklist on the silent read", () => {
    const offenders: string[] = [];
    const editorFiles: string[] = [];

    for (const abs of files) {
      const src = read(abs);
      const rendersChecklist = src.includes("<EmployeeAccessEditor") || src.includes("<PermissionChecklist");
      if (!rendersChecklist) continue;
      const file = rel(abs);
      editorFiles.push(file);

      if (src.includes("getRolePermissions(") && !SILENT_READ_ALLOWED.has(file)) {
        const line = src.slice(0, src.indexOf("getRolePermissions(")).split("\n").length;
        offenders.push(`${file}:${line}  opens an editor on the read that swallows failures`);
      }
    }

    expect(offenders).toEqual([]);
    // Non-vacuous: the screens this rule is about were actually found.
    expect(editorFiles.length).toBeGreaterThanOrEqual(3);
  });

  it("every screen that renders a checklist can say it is still waiting", () => {
    const offenders: string[] = [];

    for (const abs of files) {
      const src = read(abs);
      const file = rel(abs);
      // A shared presentational component owns no read — it is handed its state, and the
      // component itself is asserted on below.
      if (file.startsWith("src/components/")) continue;

      if (src.includes("<EmployeeAccessEditor")) {
        // The editor draws waiting/failed itself, so the screen only has to supply the state —
        // which it can only know from the reporting read.
        for (const token of ["loadRolePermissions", "state={"]) {
          if (!src.includes(token)) offenders.push(`${file}  missing ${token}`);
        }
      } else if (src.includes("<PermissionChecklist")) {
        for (const token of ["loadRolePermissions", "access.loadingRole", "access.roleUnavailable"]) {
          if (!src.includes(token)) offenders.push(`${file}  missing ${token}`);
        }
      }
    }

    // The shared editor is where those two states are actually drawn, exactly once.
    const editor = read(path.join(SRC, "components/admin/EmployeeAccessEditor.tsx"));
    for (const token of ["access.loadingRole", "access.roleUnavailable"]) {
      expect(editor).toContain(token);
    }

    expect(offenders).toEqual([]);
  });
});
