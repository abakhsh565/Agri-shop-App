import { describe, expect, it } from "vitest";
import {
  constraintSection,
  constraintStatement,
  isForeignKey,
  orderConstraintRows,
  splitConstraintPasses,
} from "../../scripts/lib/backup-constraint-order.mjs";

/**
 * The guard for the production backup defect of 2026-11-13/14.
 *
 * Two nightly backups failed `RESTORE VERIFICATION` with `structure: missing 2`, and the cause was
 * ordering, not data: the writer emitted constraints sorted by table name, so
 *
 *     co_owner_authority_catalog ... FOREIGN KEY (permission_code) REFERENCES permissions(code)
 *     dashboard_widgets          ... FOREIGN KEY (default_permission) REFERENCES permissions(code)
 *
 * were both restored BEFORE `permissions ... UNIQUE (code)` existed. Postgres answered with
 * `invalid_foreign_key` (42830), the writer's `duplicate_object` handler did not catch it, and the
 * restore carried on without them. These tests pin the order and the loudness of a failure, and they
 * are non-vacuous: the "before the fix" ordering is fed in and must come out reordered.
 */

const PERMISSIONS_UNIQUE = {
  tbl: "permissions",
  conname: "permissions_code_key",
  def: "UNIQUE (code)",
};
const CO_OWNER_FK = {
  tbl: "co_owner_authority_catalog",
  conname: "co_owner_authority_catalog_permission_code_fkey",
  def: "FOREIGN KEY (permission_code) REFERENCES permissions(code) ON DELETE CASCADE",
};
const WIDGET_FK = {
  tbl: "dashboard_widgets",
  conname: "dashboard_widgets_default_permission_fkey",
  def: "FOREIGN KEY (default_permission) REFERENCES permissions(code) ON DELETE SET NULL",
};
const CHECK = {
  tbl: "barcode_history",
  conname: "barcode_history_action_check",
  def: "CHECK (((action)::text = ANY (ARRAY['added'::character varying])))",
};

describe("backup constraint order — a restore must be able to add every constraint", () => {
  it("recognises foreign keys and leaves uniques/checks alone", () => {
    expect(isForeignKey(CO_OWNER_FK)).toBe(true);
    expect(isForeignKey(WIDGET_FK)).toBe(true);
    expect(isForeignKey(PERMISSIONS_UNIQUE)).toBe(false);
    expect(isForeignKey(CHECK)).toBe(false);
  });

  it("puts every foreign key after every unique/check, whatever the input order", () => {
    // The exact production order that broke: table name order, foreign keys first.
    const production = [CO_OWNER_FK, WIDGET_FK, PERMISSIONS_UNIQUE, CHECK];
    const ordered = orderConstraintRows(production);
    const lastStructural = ordered.map((r) => isForeignKey(r)).lastIndexOf(false);
    const firstForeignKey = ordered.findIndex((r) => isForeignKey(r));
    expect(firstForeignKey).toBeGreaterThan(lastStructural);
    expect(ordered.map((r) => r.conname)).toEqual([
      PERMISSIONS_UNIQUE.conname,
      CHECK.conname,
      CO_OWNER_FK.conname,
      WIDGET_FK.conname,
    ]);
  });

  it("is non-vacuous: the unfixed order really would have failed", () => {
    // Same list, no ordering: the FKs precede the unique they depend on — the state that produced
    // `invalid_foreign_key` and the two missing constraints.
    const unfixed = [CO_OWNER_FK, WIDGET_FK, PERMISSIONS_UNIQUE];
    expect(unfixed.indexOf(CO_OWNER_FK)).toBeLessThan(unfixed.indexOf(PERMISSIONS_UNIQUE));
    expect(orderConstraintRows(unfixed).indexOf(PERMISSIONS_UNIQUE)).toBeLessThan(
      orderConstraintRows(unfixed).indexOf(CO_OWNER_FK),
    );
  });

  it("emits the section in two named passes", () => {
    const { lines, structural, foreignKeys } = constraintSection([WIDGET_FK, PERMISSIONS_UNIQUE]);
    expect(structural.map((r) => r.conname)).toEqual([PERMISSIONS_UNIQUE.conname]);
    expect(foreignKeys.map((r) => r.conname)).toEqual([WIDGET_FK.conname]);
    const uniqueLine = lines.findIndex((l) => l.includes(PERMISSIONS_UNIQUE.conname));
    const fkLine = lines.findIndex((l) => l.includes(WIDGET_FK.conname));
    expect(uniqueLine).toBeGreaterThan(-1);
    expect(fkLine).toBeGreaterThan(uniqueLine);
  });

  it("no longer hides an unexpected failure: every statement raises a named warning", () => {
    const statement = constraintStatement(CO_OWNER_FK);
    expect(statement).toContain("exception when duplicate_object then null");
    expect(statement).toContain("when others then raise warning");
    expect(statement).toContain(
      "BACKUP CONSTRAINT NOT RESTORED: co_owner_authority_catalog.co_owner_authority_catalog_permission_code_fkey",
    );
    // The definition itself must be preserved verbatim, not paraphrased.
    expect(statement).toContain("REFERENCES permissions(code) ON DELETE CASCADE");
  });

  it("keeps a replayed backup idempotent", () => {
    // `duplicate_object` stays silent, and the existence of that branch is what makes a re-run safe.
    const statement = constraintStatement(PERMISSIONS_UNIQUE);
    expect(statement).toContain("when duplicate_object then null");
    expect(splitConstraintPasses([PERMISSIONS_UNIQUE, CO_OWNER_FK]).foreignKeys).toHaveLength(1);
  });
});
