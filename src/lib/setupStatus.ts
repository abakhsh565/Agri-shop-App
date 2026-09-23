import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useProductsStore } from "@/stores/productsStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useShellBase } from "@/lib/useShellBase";
import { useT } from "@/lib/i18n";
import { dependencyHint, type Dependency } from "@/lib/dependencyGraph";

/**
 * What "the business is set up" means — derived from the dependency graph, not chosen.
 *
 * The graph (`src/lib/dependencyGraph.ts`) records the only three entities the product
 * actually blocks on: a supplier is required before a product can be saved, a product
 * before a sale can be made, and a customer before a sale can be made. Those three are
 * therefore the required set, and this file does not add a fourth thing to move a
 * percentage — which is exactly the trap the requirement warned about.
 *
 * One product decision is deliberately left open rather than guessed: whether the shop's
 * own profile details (name, phone, address) count toward completion. Registration already
 * collects them, so for a real signup they are complete before this screen can be reached,
 * and inventing a field list here would create a requirement the system does not enforce.
 */
const REQUIRED: Dependency[] = ["supplier", "product", "customer"];

export interface SetupItem {
  id: Dependency;
  title: string;
  why: string;
  done: boolean;
  /** Where to create it — absent when this shell has no such route or the role lacks it. */
  action?: { label: string; to: string };
  /** Plain words for someone who cannot create it, instead of a dead action. */
  instead?: string;
}

export interface SetupStatus {
  items: SetupItem[];
  doneCount: number;
  total: number;
  percent: number;
  /** Every required entity exists. The guidance has done its job and should disappear. */
  complete: boolean;
  /** Every store has finished loading, so the counts are trustworthy. */
  ready: boolean;
}

export function useSetupStatus(): SetupStatus {
  const t = useT();
  const base = useShellBase();
  const { pathname } = useLocation();

  const companies = useCompaniesStore((s) => s.companies);
  const companiesReady = useCompaniesStore((s) => s.ready);
  const products = useProductsStore((s) => s.products);
  const productsReady = useProductsStore((s) => s.ready);
  const customers = useCustomersStore((s) => s.customers);
  const customersReady = useCustomersStore((s) => s.ready);

  const loadCompanies = useCompaniesStore((s) => s.load);
  const loadProducts = useProductsStore((s) => s.load);
  const loadCustomers = useCustomersStore((s) => s.load);

  // This hook reads three stores, and the status is meaningless until they have loaded —
  // it would sit on a spinner on any screen that does not already happen to populate them
  // (Settings does not). Ask for the data this view depends on, exactly once per store.
  useEffect(() => {
    if (!companiesReady) void loadCompanies();
  }, [companiesReady, loadCompanies]);
  useEffect(() => {
    if (!productsReady) void loadProducts();
  }, [productsReady, loadProducts]);
  useEffect(() => {
    if (!customersReady) void loadCustomers();
  }, [customersReady, loadCustomers]);

  const has: Record<Dependency, boolean> = {
    supplier: companies.length > 0,
    product: products.length > 0,
    customer: customers.length > 0,
  };

  const items: SetupItem[] = REQUIRED.map((id) => {
    const hint = dependencyHint(id, t, { base, returnTo: pathname });
    return {
      id,
      title: hint.title,
      why: hint.why,
      done: has[id],
      action: hint.action,
      instead: hint.instead,
    };
  });

  const doneCount = items.filter((i) => i.done).length;
  return {
    items,
    doneCount,
    total: items.length,
    percent: Math.round((doneCount / items.length) * 100),
    complete: doneCount === items.length,
    ready: companiesReady && productsReady && customersReady,
  };
}
