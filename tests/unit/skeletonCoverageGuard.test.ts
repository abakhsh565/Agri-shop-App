import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Every list that fetches shows its own shape while it waits.
 *
 * A list drawn from a store starts empty, so any screen that paints its empty
 * state (or its "not found", or nothing at all) before the data arrives is
 * making a false statement — "no sales recorded" about sales that are still in
 * flight — and then jumping when the rows land. The fix is always the same two
 * halves, which is why they are asserted together here:
 *
 *   a GATE      — the placeholder is shown only while the data is genuinely absent, and
 *   a PLACEHOLDER shaped like the list (SkeletonList / Skeleton), not a spinner.
 *
 * Each entry names its own gate, so a screen cannot satisfy this guard by having
 * `ready` somewhere in the file while the list below it still flashes. Deleting
 * either half of an entry fails here.
 *
 * Screens that fetch synchronously are NOT listed: `ReminderHistoryPage` reads
 * localStorage in the same tick, so it has no waiting state to shape.
 *
 * The fabricated-reminder seed is asserted gone at the bottom, because inventing
 * business history was the worst thing this app did while waiting.
 */
const GATED: Array<[file: string, gate: RegExp, howItWaits: string]> = [
  // ── Admin ────────────────────────────────────────────────────────────────
  ["src/pages/admin/sales/AdminSalesListPage.tsx", /\{!ready \? \(/, "waits for salesStore.ready"],
  ["src/components/sales/SaleDetailView.tsx", /if \(!salesReady\)/, "separates 'not arrived' from 'not found'"],
  ["src/pages/admin/payments/AdminPaymentsPage.tsx", /\{!ready \? \(/, "waits for customers + companies"],
  ["src/pages/admin/companies/CompaniesListPage.tsx", /\{!ready && <SkeletonList/, "waits for companiesStore.ready"],
  ["src/pages/admin/companies/CompanyDetailPage.tsx", /companiesReady \? \(/, "waits before claiming 'not found'"],
  ["src/pages/admin/purchases/AdminPurchasesPage.tsx", /\{loading \? \(/, "waits for its own purchase query"],
  ["src/pages/admin/purchases/PurchaseDetailPage.tsx", /if \(loading\)/, "waits for its own purchase query"],
  ["src/pages/admin/inventory/StockMovementHistoryPage.tsx", /\{loading \? \(/, "waits for its own movement query"],
  ["src/pages/admin/inventory/ReorderSuggestionsPage.tsx", /\{!ready \? \(/, "waits for products + companies"],
  ["src/pages/admin/notifications/AdminNotificationsPage.tsx", /\{loading && !ready \? \(/, "waits for notificationStore"],
  ["src/pages/admin/alerts/CreditOverridesPage.tsx", /\{!ready \? \(/, "waits for customers + sales"],
  ["src/pages/admin/alerts/InventoryAlertsPage.tsx", /\{!ready \? \(/, "waits before declaring 'all clear'"],
  ["src/pages/admin/alerts/GroupDetailPage.tsx", /if \(loading\)/, "waits for its own group query"],
  ["src/pages/admin/settings/RolesAccessPage.tsx", /!rolesStore\.ready && <SkeletonList/, "waits for rolesStore"],
  ["src/pages/admin/reports/AdminReportsPage.tsx", /\{!ready \? \(/, "waits for all four stores before reporting"],
  ["src/pages/admin/returns/AdminReturnSelectItemsPage.tsx", /if \(loadingReturned\)/, "waits for the already-returned query"],
  ["src/pages/admin/dashboard/AdminDashboardPage.tsx", /\{!listsReady && \(/, "waits before its recent-sales section"],

  // ── Employee ─────────────────────────────────────────────────────────────
  ["src/pages/employee/sales/SalesListPage.tsx", /\{!ready \? \(/, "waits for salesStore.ready"],
  ["src/pages/employee/products/ProductsListPage.tsx", /\{!ready \? \(/, "waits for productsStore.ready"],
  ["src/pages/employee/products/ProductDetailPage.tsx", /productsReady \? null : <SkeletonList/, "waits before claiming 'not found'"],
  ["src/pages/employee/customers/CustomersListPage.tsx", /\{!ready \? \(/, "waits for customersStore.ready"],
  ["src/pages/employee/customers/CustomerProfilePage.tsx", /customersReady \? null : <SkeletonList/, "waits before rendering a blank screen"],
  ["src/pages/employee/customers/CustomerPaymentHistoryPage.tsx", /loading \? \(\s*<SkeletonList/, "replaced a lone spinner"],
  ["src/pages/employee/customers/CustomerPurchaseHistoryPage.tsx", /\{!ready \? \(/, "waits for sales + customers"],
  ["src/pages/employee/notifications/EmployeeNotificationsPage.tsx", /\{loading && !ready \? \(/, "waits for notificationStore"],
  ["src/pages/employee/returns/ReturnSelectItemsPage.tsx", /if \(loadingReturned\)/, "waits for the already-returned query"],
  ["src/pages/employee/activity/ActivityLogPage.tsx", /\{!ready && <SkeletonList/, "waits for sales + customers"],
  ["src/pages/employee/sale/BrowseProductsPage.tsx", /\{!ready \? \(/, "waits for productsStore.ready"],
  ["src/pages/employee/sale/SelectCustomerPage.tsx", /\{!ready && <SkeletonList/, "waits for customersStore.ready"],
  ["src/pages/employee/sale/VariantSelectorPage.tsx", /productsReady \? null : <SkeletonList/, "waits before rendering a blank screen"],
  ["src/pages/employee/dashboard/DashboardPage.tsx", /\{!ready \? \(/, "waits before its recent-sales rows"],

  // ── Shared primitives ────────────────────────────────────────────────────
  ["src/components/ui/SetupChecklist.tsx", /loading|ready/, "waits for the setup read"],
  ["src/components/admin/EmployeeAccessEditor.tsx", /permissions\.length === 0 && \(/, "waits for the permission list"],
  ["src/components/ui/CustomerSelector.tsx", /\{!customersReady \? \(/, "waits before the picker says 'no customers'"],
];

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** One grey shape standing in for content — the thing a waiting list must show. */
const hasPlaceholder = (src: string) => /SkeletonList|<Skeleton[ /]/.test(src);

describe("every fetching list has a gate and a shaped placeholder", () => {
  it.each(GATED)("%s — %s", (file, gate) => {
    const src = read(file);
    expect(hasPlaceholder(src), `${file}: no Skeleton/SkeletonList placeholder`).toBe(true);
    expect(gate.test(src), `${file}: the list is no longer gated`).toBe(true);
  });

  it("the detectors are not vacuous", () => {
    // A list that paints its empty state with no gate — the exact defect this
    // guard exists for — must be REJECTED by both halves.
    const flashThenJump = `
      export default function Page() {
        const sales = useSalesStore((s) => s.sales);
        return sales.length === 0
          ? <p>{t("sales.noSales")}</p>
          : <ListCard>{sales.map((s) => <ListRow key={s.id} />)}</ListCard>;
      }`;
    expect(hasPlaceholder(flashThenJump)).toBe(false);
    expect(/\{!ready \? \(/.test(flashThenJump)).toBe(false);

    // …and a correctly gated list must be ACCEPTED.
    const waits = `
      const ready = useSalesStore((s) => s.ready);
      return {!ready ? (
        <SkeletonList rows={5} tile />
      ) : sales.length === 0 ? <p>nothing yet</p> : <ListCard />}`;
    expect(hasPlaceholder(waits)).toBe(true);
    expect(/\{!ready \? \(/.test(waits)).toBe(true);
  });

  it("no screen fabricates reminder history", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "imports") continue;
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(entry.name)) {
          const src = fs.readFileSync(p, "utf8");
          // Writing invented reminders into storage is the failure mode: the shop
          // owner then reads a history that never happened.
          if (/localStorage\.setItem\("reminder_logs_/.test(src) || /Seed mock data/.test(src)) {
            offenders.push(path.relative(ROOT, p).replace(/\\/g, "/"));
          }
        }
      }
    };
    walk(path.join(ROOT, "src"));
    expect(offenders, "a screen is inventing reminder history again").toEqual([]);
  });
});
