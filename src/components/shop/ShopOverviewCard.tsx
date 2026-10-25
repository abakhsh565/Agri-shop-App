import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useT } from "@/lib/i18n";
import { useShopStore } from "@/stores/shopStore";
import { hasPermission } from "@/lib/tenantContext";

/**
 * Figures only, no currency prefix (owner's decision, 2026-10-25). The labels already say what
 * each number is, and three `Rs.` in a row made a narrow card read as a table of prices rather
 * than a snapshot.
 *
 * COMPACT UNITS (owner's decision, 2026-10-25): a nine-digit rupee amount is unreadable in a
 * third of a phone width, so the card abbreviates thousands and millions the way the shop
 * speaks — K and M, at most two decimals, trailing zeros dropped. 49,294,000 becomes `49.29M`,
 * 944,500 becomes `944.5K`, 30,000 becomes `30K`. Below a thousand nothing is abbreviated.
 * Counts (employees) are people, not money, and stay whole.
 */
function trimUnit(value: number) {
  return value.toFixed(2).replace(/0+$/, "").replace(/[.]$/, "");
}

function formatAmount(n: number) {
  const amount = Math.round(n);
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${trimUnit(amount / 1_000_000)}M`;
  if (abs >= 1_000) return `${trimUnit(amount / 1_000)}K`;
  return String(amount);
}

/**
 * The working branch's three facts, as one card: what its stock is worth, how many people work
 * there, and how much it is still owed.
 *
 * ALL THREE FOLLOW THE BRANCH (owner's correction, 2026-10-25, twice). The first version was
 * business-wide and an owner working in a second branch read it as that branch's. The second
 * version made only the staff count follow the branch and labelled the other two as covering all
 * branches — honest, but not the answer asked for. Since migration 0237 the server answers all
 * three from this branch alone: staff from the branch assignments the roster records, stock
 * from the movement ledger stamped with this branch, receivables from the sales and payments
 * recorded there.
 *
 * What the numbers mean, because a card must not make its reader guess:
 *   • Inventory — what this branch received and has not sold, at today's cost. Stock that left a
 *     branch it never arrived at is worth nothing there rather than a negative shelf. A variant
 *     the ledger has never seen (imported before branch stamping) sits whole on the default
 *     branch, because there is nowhere else it could have been.
 *   • Employees — active, non-owner people the roster ties to this branch: an explicit branch
 *     scope or an explicit per-branch role. Owners are labelled Owner on the team screen and are
 *     not staff; suspended and invited accounts are not counted either.
 *   • Total credit — what this branch billed and has not collected at this branch.
 * NOTHING is added to any branch to make the three add up to the business: 0236 removed the
 * remainder-to-main rule because an empty main branch read "3 employees, 40,000 credit" and the
 * owner could not tell whose money or people those were. A customer balance that no sale or
 * payment explains is bookkeeping drift, not a receivable of any branch, and is not placed on
 * one to make the totals reconcile.
 *
 * THE SHAPE IS THE OWNER'S REFERENCE: one plate, three columns, the figure on top and its name
 * beneath, no icons. The plate is a tone surface, not literal white (owner's correction,
 * 2026-10-25): it follows the theme, so in dark it is the same card tone as every other card.
 *
 * A missing figure is "—", never 0. The server returns NULL for a column the caller may not
 * see (`inventory.view`, `customers.view`), and a branch whose cost data is incomplete shows a
 * floor (`≥`) rather than a smaller — wrong — number.
 */
export default function ShopOverviewCard() {
  const t = useT();
  const navigate = useNavigate();
  const activeShopId = useShopStore((s) => s.activeShopId);
  const activeBranchId = useShopStore((s) => s.activeBranchId);

  const branches = useShopStore((s) => s.branches);
  const branchesLoaded = useShopStore((s) => s.branchesLoaded);
  const loadBranches = useShopStore((s) => s.loadBranches);

  // The branch this card speaks for comes from the one store that owns that fact. The tenant
  // check matters between a shop switch and its reload: the previous business's rows are still
  // in this list for a moment, and a branch id from them would show a branch of the shop the
  // account just left.
  const shopBranches = branches.filter((branch) => branch.tenantId === activeShopId);
  const activeBranch = shopBranches.find((branch) => branch.id === activeBranchId) ?? null;

  // This screen is reached without the dashboard's preload, so it asks for the branch list it
  // reads. The live store flags are checked rather than the render's copies: the Branches block
  // may be mounting in the same commit and may have just started the same call.
  useEffect(() => {
    const state = useShopStore.getState();
    if (!state.branchesLoaded && !state.branchesLoading) void state.loadBranches();
  }, [branchesLoaded, loadBranches, activeShopId]);

  const inventoryValue = branchesLoaded ? activeBranch?.inventoryValue ?? null : null;
  const inventoryIncomplete = branchesLoaded && activeBranch?.inventoryCostIncomplete === true;
  const creditOutstanding = branchesLoaded ? activeBranch?.creditOutstanding ?? null : null;

  const inventoryValueLabel = inventoryValue == null
    ? "—"
    : inventoryIncomplete
      ? inventoryValue > 0 ? `≥ ${formatAmount(inventoryValue)}` : "—"
      : formatAmount(inventoryValue);

  return (
    <section className="px-4 pt-3.5" data-testid="shop-overview">
      {/* One block, two bands, as the owner's reference: the invitation is a solid strip and
          the figures sit on the card directly under it, sharing the same outer corners. The
          strip is the product's brand colour in BOTH themes (owner's correction, 2026-10-25):
          the reference's coloured band is the point, and black-in-light made it two designs. */}
      <div className="rounded-[var(--radius-card)] overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3" style={{ background: "var(--brand)" }}>
          <p className="text-13 font-semibold text-pretty leading-snug flex-1 min-w-0" style={{ color: "#0a0a0a" }}>
            {t("shop.inviteIntro")}
          </p>
          {hasPermission("employees.view") && hasPermission("employees.manage") && (
            <button
              type="button"
              onClick={() => navigate("/admin/employees/new")}
              data-testid="shop-overview-invite"
              className="ds-pressable h-9 px-4 rounded-full text-13 font-semibold shrink-0"
              style={{ background: "var(--tone-card)", color: "var(--text-primary)" }}
            >
              {t("shop.invite")}
            </button>
          )}
        </div>

        <div className="px-2 py-5" style={{ background: "var(--tone-card)" }}>
          {/* No branch caption (owner's correction, 2026-10-25): the working branch is already
              named in the header, and repeating it here pushed the three figures down and made
              the card read as a table of sections. The figures are 2px smaller than the first
              layout so a seven-digit amount and its neighbours stay on one line. */}
          <div className="grid grid-cols-3">
            <div className="min-w-0 text-center">
              <p className="text-16 font-bold leading-tight break-words" style={{ color: "var(--text-primary)" }} data-testid="shop-overview-inventory">
                {inventoryValueLabel}
              </p>
              <p className="text-14 mt-1 leading-tight" style={{ color: "var(--text-secondary)" }}>{t("admin.inventory")}</p>
            </div>
            <div className="min-w-0 text-center">
              <p className="text-16 font-bold leading-tight" style={{ color: "var(--text-primary)" }} data-testid="shop-overview-employees">
                {activeBranch?.employeeCount != null
                  ? activeBranch.employeeCount.toLocaleString("en-PK")
                  : "—"}
              </p>
              <p className="text-14 mt-1 leading-tight" style={{ color: "var(--text-secondary)" }}>{t("admin.employees")}</p>
            </div>
            <div className="min-w-0 text-center">
              <p className="text-16 font-bold leading-tight break-words" style={{ color: "var(--text-primary)" }} data-testid="shop-overview-credit">
                {creditOutstanding != null ? formatAmount(creditOutstanding) : "—"}
              </p>
              <p className="text-14 mt-1 leading-tight" style={{ color: "var(--text-secondary)" }}>{t("shop.totalCredit")}</p>
            </div>
          </div>

          {/* The one note that explains a total, on its own line under a hairline: a fourth
              line inside the inventory column would make the other two look incomplete. */}
          {inventoryIncomplete && inventoryValue != null && (
            <div className="mt-3 pt-2 px-1" style={{ borderTop: "1px solid var(--divider)" }}>
              <p className="text-9 leading-snug" style={{ color: "var(--text-tertiary)" }}>{t("shop.inventoryValueIncomplete")}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
