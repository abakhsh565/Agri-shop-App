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
 *   2. **Unknown is never zero.** Products and customers are business-wide in the current
 *      model, and restricted counts may be hidden. The label only says "empty" when the
 *      values actually prove emptiness; otherwise it states only known facts or stays neutral.
 *
 * `t` is passed in rather than imported so this stays a pure function with no store or
 * language dependency, the way the app's other label helpers are written.
 */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface BranchCounts {
  employeeCount: number | null;
  productCount: number | null;
}

/**
 * What a branch needs to say where it is: its own name, the address on file, and the place it
 * was pinned at (null when it never was).
 *
 * Structural on purpose — the branch summary, a row of the branch read and the branch itself are
 * all this shape, and a helper that demanded one concrete type would need a copy per caller.
 */
export interface BranchPlaceParts {
  name: string;
  address: string | null;
  place: { label?: string | null; address?: string | null } | null;
}

/**
 * Where a branch is, in one line: its address, then the place name when that adds something.
 *
 * Three rules, all about not repeating what the line already says:
 *
 *   1. **The address is shown whether or not the branch was ever pinned.** An address on file is
 *      a fact about the branch; the pin is a fact about the map. A branch with an address and no
 *      pin is not "no location" — the location is written down, it just has no point yet.
 *   2. **The place name is only appended when the address does not already contain it,** so a
 *      reverse-geocoded address does not end in the name of its own city.
 *   3. **The store's fallback label is the branch's own name** (`location_label ?? name`), and
 *      "… · Warehouse Branch" would say the name twice.
 *
 * `null` means there is genuinely nothing to say, and the caller writes its own sentence —
 * the same split `branchContextLabel` uses above.
 */
export function branchPlaceLine(branch: BranchPlaceParts): string | null {
  const address = branch.place?.address ?? branch.address ?? null;
  const rawLabel = branch.place?.label ?? null;
  const label =
    rawLabel && rawLabel !== branch.name && !(address ?? "").includes(rawLabel) ? rawLabel : null;
  const parts = [address, label].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function branchContextLabel(t: Translate, branch: BranchCounts): string {
  const parts: string[] = [];

  if (branch.employeeCount != null && branch.employeeCount > 0) {
    parts.push(
      t(branch.employeeCount === 1 ? "branches.employeeOne" : "branches.employeeOther", {
        count: String(branch.employeeCount),
      }),
    );
  }

  if (branch.productCount != null && branch.productCount > 0) {
    parts.push(
      t(branch.productCount === 1 ? "branches.productOne" : "branches.productOther", {
        count: String(branch.productCount),
      }),
    );
  }

  if (parts.length > 0) return parts.join(" · ");
  if (branch.employeeCount === 0 && branch.productCount === 0) return t("branches.contextEmpty");
  if (branch.employeeCount === 0) return t("branches.contextNoStaff");
  if (branch.employeeCount == null && branch.productCount == null) return t("branches.contextUnknown");
  if (branch.employeeCount != null && branch.productCount != null) {
    // Both known but zero or negative: that is a real, readable state, not an unknown one.
    if (branch.employeeCount === 0) return t("branches.contextNoStaff");
    if (branch.productCount === 0) return t("branches.contextEmpty");
  }
  // Any remaining case is either truly unknown, or known in one field and missing in the
  // other — which for a business-wide master and a permission-bounded count is the same 
  // practical outcome: state only what is proven.
  return t("branches.contextUnknown");
}
