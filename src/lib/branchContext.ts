/**
 * The one line that says what is inside a branch.
 *
 * Two screens want this — Home, when the account is working in a branch it added, and the
 * Branches screen, on every row — and two derivations of the same sentence is how they end
 * up disagreeing about the same branch (one counting staff, the other counting everyone,
 * one saying "1 employees"). So the sentence is written once, here, and the screens choose
 * where to put it.
 *
 * Two rules it keeps:
 *
 *   1. **Counts are said in the right number.** "1 employees" is the kind of thing that
 *      makes an app feel unfinished, and every count on this line is a number that is
 *      regularly 1 in a new branch.
 *   2. **An empty branch says so in words, not in zeroes.** "0 employees · 0 products" is
 *      noise; "No staff or products yet" tells the owner what to do next.
 *
 * `t` is passed in rather than imported so this stays a pure function with no store or
 * language dependency, the way the app's other label helpers are written.
 */
export type Translate = (key: string, params?: Record<string, string>) => string;

export interface BranchCounts {
  employeeCount: number;
  productCount: number;
}

export function branchContextLabel(t: Translate, branch: BranchCounts): string {
  const parts: string[] = [];

  if (branch.employeeCount > 0) {
    parts.push(
      t(branch.employeeCount === 1 ? "branches.employeeOne" : "branches.employeeOther", {
        count: String(branch.employeeCount),
      }),
    );
  }

  if (branch.productCount > 0) {
    parts.push(
      t(branch.productCount === 1 ? "branches.productOne" : "branches.productOther", {
        count: String(branch.productCount),
      }),
    );
  }

  if (parts.length === 0) return t("branches.contextEmpty");
  return parts.join(" · ");
}
