import type { I18nKey, TranslateFn } from "@/lib/i18n";
import { hasPermission } from "@/lib/tenantContext";

/**
 * THE DEPENDENCY GRAPH, IN ONE PLACE
 *
 * Two things in this product can stop a user mid-task: a workflow that needs an
 * entity that does not exist yet, and a validator that refuses to save without one.
 * Both are the same problem, so both read from here rather than each screen wording
 * its own version of "nothing here yet".
 *
 * Feature registry and reverse dependencies: see FEATURE-MAP.md / feature-registry.json.
 *
 * What the code actually enforces (derived by reading the flows, not assumed):
 *
 *   Sale ──▶ Customer   blocking: SelectCustomerPage is step 1 of the flow, and the
 *                       only ways forward are picking one or creating one.
 *        ──▶ Product    blocking: BrowseProductsPage renders the sellable list; with
 *                       zero products there is nothing to tap, so no line can be added.
 *   Product ──▶ Supplier  blocking: AddProductPage refuses to save without a company
 *                       ("copy.selectSupplier"), and Product.company is what the
 *                       purchase and stock screens key on.
 *   Purchase ──▶ Supplier blocking: RecordPurchasePage cannot record without one.
 *             ──▶ Product  blocking: a purchase line needs a product to receive stock.
 *
 * Everything else is NOT a create-dependency: a return, payment, reminder or group all
 * hang off a sale or customer that already exists by the time you reach them, and an
 * employee/role is optional for trading. So this graph is deliberately three entities
 * wide — adding more would be inventing dependencies the code does not have.
 */

/** The two shells, exactly as `useShellBase()` returns them. */
export type ShellBase = "/admin" | "/employee" | "/co-owner";

export type Dependency = "supplier" | "product" | "customer";

interface Spec {
  /**
   * Where the entity is created for this shell, and the permission that route's own
   * guard requires — read from the router rather than inferred. Returns null when the
   * route does not exist in this shell at all:
   *   /admin/inventory/new    → under PermissionGuard requires="products.view"
   *   /employee/inventory/new → under PermissionGuard requires="products.create"
   *   /admin/companies/new  → under PermissionGuard requires="companies.view"
   *   /admin/customers/new  → under PermissionGuard requires="customers.view"
   *   /employee/customers/new → unguarded
   */
  create: (base: ShellBase) => { to: string; requires: string } | null;
  // Typed against the dictionary, not `string`: these are literal key tables, so a
  // typo here would otherwise render a raw key to the shop owner. This is the check
  // that a permissive t() cannot give — it lands on the declaration instead.
  titleKey: I18nKey;
  whyKey: I18nKey;
  actionKey: I18nKey;
  /** Plain words for someone who cannot create it, instead of a dead action. */
  cannotKey: I18nKey;
}

const GRAPH: Record<Dependency, Spec> = {
  supplier: {
    create: (base) =>
      base === "/admin" ? { to: `${base}/companies/new`, requires: "companies.view" } : null,
    titleKey: "dep.supplier.title",
    whyKey: "dep.supplier.why",
    actionKey: "dep.supplier.action",
    cannotKey: "dep.supplier.cannot",
  },
  product: {
    // Both shells now answer: the employee route carries `products.create`, which is also the
    // grant the create RPC checks — so the offered action is one that will actually open.
    create: (base) => ({ to: `${base}/inventory/new`, requires: "products.create" }),
    titleKey: "dep.product.title",
    whyKey: "dep.product.why",
    actionKey: "dep.product.action",
    cannotKey: "dep.product.cannot",
  },
  customer: {
    create: (base) => ({ to: `${base}/customers/new`, requires: "customers.view" }),
    titleKey: "dep.customer.title",
    whyKey: "dep.customer.why",
    actionKey: "dep.customer.action",
    cannotKey: "dep.customer.cannot",
  },
};

/**
 * The one parameter that carries "and then come back". Reading it is deliberately
 * restricted to same-app absolute paths: a create screen that accepted an arbitrary
 * `returnTo` would be an open redirect, which is a real defect rather than a nicety.
 */
const RETURN_TO = "returnTo";

export function withReturn(path: string, returnTo: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${RETURN_TO}=${encodeURIComponent(returnTo)}`;
}

export function readReturnTo(searchParams: URLSearchParams, fallback: string): string {
  const raw = searchParams.get(RETURN_TO);
  if (!raw) return fallback;
  // Must be an in-app path: one leading slash, and not protocol-relative ("//evil").
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  return raw;
}

/**
 * Send a newly created record back to the workflow that asked for it, carrying its id
 * so the previously empty picker can open with it already chosen — "create the missing
 * thing and continue", rather than "create it and work out where you were".
 *
 * When there is no caller (the user opened the create form on its own), this returns
 * the section's own list, so normal navigation is unchanged.
 */
export function withCreatedId(
  returnTo: string,
  fallback: string,
  param: string,
  id: string,
): string {
  if (returnTo === fallback) return fallback;
  const sep = returnTo.includes("?") ? "&" : "?";
  return `${returnTo}${sep}${param}=${encodeURIComponent(id)}`;
}

/**
 * The path to hand a creator, so that coming back lands on THIS screen AND this screen
 * still remembers the workflow it was opened for.
 *
 * Without this the chain breaks at the second hop, which is a real defect rather than a
 * detail: the sale opens the product form (returnTo=/admin/sale/products), the product
 * form opens the supplier form, and a plain `returnTo=/admin/inventory/new` there means
 * the supplier returns to the product form which has by then FORGOTTEN the sale — so
 * saving the product drops the user in the inventory list instead of back in the sale.
 * Composing the two keeps the whole path: sale ← product form ← supplier form.
 */
export function backToSelf(here: string, ownReturnTo: string, fallback: string): string {
  return ownReturnTo === fallback ? here : withReturn(here, ownReturnTo);
}

export interface DependencyHint {
  /** What is missing, in plain words. */
  title: string;
  /** Why it matters to the task in hand — omitted when that is obvious. */
  why: string;
  /** Present only when this role can actually create it. */
  action?: { label: string; to: string };
  /** Present instead of `action` when it cannot. */
  instead?: string;
}

/**
 * Turn a missing entity into something renderable at the point of need: what it is,
 * why it matters, and the action that creates it and returns here afterwards.
 */
export function dependencyHint(
  kind: Dependency,
  t: TranslateFn,
  opts: { base: ShellBase; returnTo: string },
): DependencyHint {
  const spec = GRAPH[kind];
  const route = spec.create(opts.base);
  // The action is offered only when it will actually open. Handing a user a link the
  // route guard bounces is the same dead end wearing a button, so availability is the
  // route existing in this shell AND the caller holding the permission that route
  // checks — the graph cannot promise more than the router does.
  const canCreate = route !== null && hasPermission(route.requires);
  return {
    title: t(spec.titleKey),
    why: t(spec.whyKey),
    action: canCreate ? { label: t(spec.actionKey), to: withReturn(route!.to, opts.returnTo) } : undefined,
    instead: canCreate ? undefined : t(spec.cannotKey),
  };
}
