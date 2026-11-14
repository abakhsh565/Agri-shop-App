/**
 * The employee's report is a record, not a form.
 *
 * Everything on it is derived from sales, returns and voids that were recorded elsewhere. If a
 * field ever appears on this screen, the report stops being evidence of what happened and becomes
 * an editor for it — so the invariant is enforced here rather than left to the next redesign.
 *
 * This is a source guard on purpose: it is the presence of an editable control that matters, not
 * the value in it, and the screen is covered end to end by the reports lane.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const FILE = "src/pages/employee/reports/MyReportsPage.tsx";
const SOURCE = readFileSync(join(process.cwd(), FILE), "utf8");

const EDITABLE = [
  { name: "input", pattern: /<input\b/ },
  { name: "textarea", pattern: /<textarea\b/ },
  { name: "select", pattern: /<select\b/ },
  { name: "contentEditable", pattern: /contentEditable/ },
];

/** The editable controls a source file renders, by name. */
export function editableControls(source: string): string[] {
  return EDITABLE.filter((entry) => entry.pattern.test(source)).map((entry) => entry.name);
}

describe("the employee report cannot be edited", () => {
  test("renders no field that could change a figure", () => {
    expect(editableControls(SOURCE)).toEqual([]);
  });

  test("says so at the top and again in the footer", () => {
    expect(SOURCE).toContain('data-testid="reports-read-only"');
    expect(SOURCE).toContain('data-testid="reports-footer"');
    expect(SOURCE).toContain('t("reports.readOnlyNote")');
  });

  test("the scanner is not vacuous", () => {
    expect(editableControls('<input value="1" />')).toEqual(["input"]);
    expect(editableControls("<textarea />")).toEqual(["textarea"]);
    expect(editableControls("<div contentEditable />")).toEqual(["contentEditable"]);
    // …and the real screen still passes the same scanner.
    expect(editableControls(SOURCE)).toEqual([]);
  });
});
