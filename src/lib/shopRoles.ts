/**
 * Which role this account holds in each of its branches, as one plain map.
 *
 * There is a question nothing else in the app could answer: *in the branch this notification
 * came from, am I an owner or an employee?* The account-level role (`users.role`) cannot
 * answer it — it is one value for the whole person, and a person who runs one branch and is
 * merely staff in another has both — and the notification store cannot read the branch list
 * itself without importing the store that already imports it.
 *
 * So the answer lives here: a value, not a store, written by whoever last read the branches
 * and read by whoever needs the answer. It is deliberately not persisted and deliberately
 * not authoritative — the database decides what a person may do. It only decides how a row
 * that already exists should be described.
 *
 * An absent entry is not an error and not a denial: the caller falls back to the account
 * role, which is exactly the rule that was in force before this map existed.
 */

let roleByShop: Record<string, string> = {};

/** Record the roles the branch list just reported. Replaces, never merges. */
export function setShopRolesByShop(next: Record<string, string>): void {
  roleByShop = next;
}

/** The role held in one branch, or undefined when it has not been read. */
export function shopRoleOf(shopId: string | null | undefined): string | undefined {
  return shopId ? roleByShop[shopId] : undefined;
}

/** Nothing is known about anybody: called when the account changes. */
export function clearShopRoles(): void {
  roleByShop = {};
}
