import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Store } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import Button from "@/components/ui/Button";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import LocationField from "@/components/ui/LocationField";
import Checkbox from "@/components/ui/Checkbox";
import { supabase } from "@/lib/supabase";
import type { PickedPlace } from "@/lib/geo";
import { useT } from "@/lib/i18n";
import { useShopStore, type BranchSummary } from "@/stores/shopStore";
import { useRolesStore } from "@/stores/rolesStore";
import { useUIStore } from "@/stores/uiStore";
import { useShellBase } from "@/lib/useShellBase";

/**
 * Editing one branch — everything that was answered when it was created.
 *
 * Creating a branch collects two things: a name and which roles it starts with. Both are
 * editable here, which is the point the request makes about products: an input you can set
 * but never change is not management.
 *
 * The name is edited in place. The roles are NOT, and that is a deliberate limit rather
 * than a missing feature: a role belongs to the branch it was created in, and this app's
 * role screens — the list, the permission grid, the delete — are all authorized against
 * the branch the account is working in. Showing another branch's roles in a form here and
 * then having every save refused would be worse than saying where they are edited. So for
 * the branch you are standing in, the roles are listed with the number of people on each
 * and this sheet hands off to the real role screen; for any other branch the sheet names
 * where they live and offers to open it, stating the consequence it has — that opening it
 * means working in that branch.
 *
 * The main branch carries one extra sentence: it can be renamed and never deleted, which is
 * the reason it has no Delete row anywhere on the Branches screen.
 *
 * The location is read from the branch row the list handed in and written through `set_place`,
 * which is the only writer that knows a location is a point inside Pakistan. It is deliberately
 * not read back from `shops`: that table may only be read for the branch the account is working
 * in, so a query for any other branch comes back empty — not failed — and the picker would state
 * that a branch which is pinned has never been located.
 */

/** Two pins are the same pin when they are the same point; the label is a name for it, not the it. */
function placeKeyOf(place: PickedPlace | null): string | null {
  return place ? `${place.lat},${place.lng}` : null;
}
export default function BranchEditSheet({
  branch,
  onClose,
  onRenamed,
}: {
  branch: BranchSummary;
  onClose: () => void;
  onRenamed: (name: string) => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const base = useShellBase();
  const { addToast } = useUIStore();

  const renameBranch = useShopStore((s) => s.renameBranch);
  const setBranchPlace = useShopStore((s) => s.setBranchPlace);
  const setMarketplaceSettings = useShopStore((s) => s.setMarketplaceSettings);
  const switchTo = useShopStore((s) => s.switchTo);

  const roles = useRolesStore((s) => s.roles);
  const rolesReady = useRolesStore((s) => s.ready);
  const loadRoles = useRolesStore((s) => s.load);
  const getRoleMemberCount = useRolesStore((s) => s.getRoleMemberCount);

  const [name, setName] = useState(branch.name);
  /**
   * Where this branch is, as a point — read from the branch row, then picked on a map.
   *
   * Read rather than assumed: the sheet can be opened on a branch that has never had a location,
   * on one pinned last week, and everything in between, and "nothing here yet" must not look like
   * "somewhere else". Nothing is written until Save.
   *
   * It comes from the branch the screen handed in, NOT from a `shops` query of our own. `shops`
   * may only be read for the shop the account is working in, so querying it for any other branch
   * returned an empty result — not an error — and the field said "Choose on the map" about a
   * branch that was already pinned. `get_my_branches()` is the read allowed to see every branch
   * the account belongs to, so the place travels with the branch.
   */
  const [place, setPlace] = useState<PickedPlace | null>(branch.place);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  /**
   * The save guard is a ref, not `saving`.
   *
   * `saving` is a state variable, so it is still `false` for the second tap of a double
   * tap inside the same task — two saves would go out for one intention, and the second
   * could land after the sheet has closed. The ref is set synchronously, before anything
   * awaits, which is what actually stops the second one.
   */
  const savingRef = useRef(false);
  /**
   * This branch's marketplace decision, as it stands in the sheet — and as it stands saved.
   *
   * A pair on purpose: the value above is what the person is choosing, the value below is what
   * the database last accepted. Comparing them is what makes "nothing changed" mean nothing is
   * written, and what keeps a refused change on screen instead of quietly reverting to a value
   * the person did not pick.
   *
   * The switch is the whole decision. There is no distance here, because how far a farmer is
   * willing to search from is the farmer's choice, made in the farmer app — a branch answers
   * only where it is.
   */
  const [marketplaceOn, setMarketplaceOn] = useState(branch.marketplaceEnabled);
  const [savedMarket, setSavedMarket] = useState({ enabled: branch.marketplaceEnabled });
  const [marketError, setMarketError] = useState<string | null>(null);

  // The branch being edited is the active one: its roles are the ones this app can read,
  // so they are what the sheet can list. Any other branch gets the sentence and the way in.
  const isActive = branch.isCurrent;
  useEffect(() => {
    if (!isActive) return;
    if (!rolesReady) void loadRoles();
  }, [isActive, rolesReady, loadRoles]);

  useEffect(() => {
    if (!isActive || roles.length === 0) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, number> = {};
      for (const role of roles) next[role.id] = await getRoleMemberCount(role.id);
      if (!cancelled) setCounts(next);
    })();
    return () => { cancelled = true; };
  }, [isActive, roles, getRoleMemberCount]);

  const clean = name.trim();
  // A location is saved by the same button as the name, so "nothing to save" has to account for
  // both: a branch whose name is unchanged but whose pin was just moved is a pending change.
  // The starting point is what the row already holds, so a sheet opened and closed without
  // touching anything is not a pending write.
  const [savedPlaceKey, setSavedPlaceKey] = useState<string | null>(placeKeyOf(branch.place));
  const placeKey = placeKeyOf(place);
  // A listing is a pending change when the switch moved — that is the whole decision here.
  const marketDirty = marketplaceOn !== savedMarket.enabled;
  // A farmer measures the distance from their own search point, so a branch that was never
  // pinned can never be found however close the search is; the switch cannot be turned ON
  // without a location. Turning it OFF is always allowed, whatever state it is in.
  const hasPin = place !== null;
  const canList = hasPin || marketplaceOn;
  const dirty = clean !== branch.name.trim() || placeKey !== savedPlaceKey || marketDirty;

  async function handleSave() {
    if (savingRef.current) return;
    savingRef.current = true;
    setError(null);
    setMarketError(null);
    setSaving(true);
    const result = await renameBranch(branch.id, clean);
    savingRef.current = false;
    setSaving(false);
    if (!result.ok) {
      // An error is not a refusal the person can fix by tapping again blindly; it is shown
      // under the field they typed in.
      setError(
        result.code === "name_required" ? t("branches.nameRequired")
          : result.code === "name_taken" ? t("branches.nameTaken")
            : result.code === "name_too_long" ? t("branches.nameTooLong")
              : result.code === "denied" ? t("branches.delete.errDenied")
                : t("branches.saveFailed"),
      );
      return;
    }

    // The location, saved by the same button as the name — INCLUDING when it was taken back.
    //
    // Through `set_place` rather than a direct UPDATE: that is the one writer that knows a
    // location must be a point inside Pakistan, and it checks that the branch belongs to a tenant
    // the caller is a member of. A refusal is reported where the picker is, not swallowed — a pin
    // that did not save must never look like one that did.
    //
    // The condition is "the pin changed", not "there is a pin". Pressing the field's clear
    // control empties it, and saving that used to write nothing at all: the sheet said the branch
    // was saved, the row kept the old point, and reopening showed it back. Clearing a location is
    // a change like any other, so it is written like one.
    if (placeKey !== savedPlaceKey) {
      const { error: placeError } = await supabase.rpc("set_place", {
        p_table: "shops",
        p_id: branch.id,
        p_latitude: place?.lat ?? null,
        p_longitude: place?.lng ?? null,
        p_label: place?.label ?? null,
        p_address: place?.address ?? null,
        p_source: place?.source ?? null,
      });
      if (placeError) {
        setError(t("branches.locationFailed"));
        savingRef.current = false;
        setSaving(false);
        return;
      }
      setSavedPlaceKey(placeKey);
      // The list is what the next open of this sheet reads, so it is told now rather than after a
      // round trip: a pin that saved must not come back as the old one a moment later.
      setBranchPlace(branch.id, place);
    }

    // ── The marketplace decision ──────────────────────────────────────────────
    // Saved by the same button as the name and the pin, and deliberately AFTER the pin: the
    // database refuses to list a branch that has no location, so a pin picked on this very
    // visit has to be written first — otherwise the listing would be refused for a state the
    // person can already see is no longer true.
    if (marketDirty) {
      if (marketplaceOn && !hasPin) {
        setMarketError(t("marketplace.branchNoLocation"));
        return;
      }
      const marketResult = await setMarketplaceSettings(branch.id, marketplaceOn);
      if (!marketResult.ok) {
        setMarketError(
          marketResult.code === "no_location" ? t("marketplace.branchNoLocation")
            : marketResult.code === "denied" ? t("marketplace.branchDenied")
              : t("marketplace.branchSaveFailed"),
        );
        return;
      }
      setSavedMarket({ enabled: marketplaceOn });
    }

    addToast(t("branches.saved", { branch: clean }), "success");
    onRenamed(clean);
  }

  /** Working in another branch is what changing its roles means; say so, then do it. */
  async function openRoles() {
    if (!isActive) {
      const result = await switchTo(branch.id);
      if (!result.ok) {
        addToast(
          t(result.code === "pending_sync" ? "shop.pendingSync" : "shop.switchFailed"),
          result.code === "pending_sync" ? "warning" : "error",
        );
        return;
      }
      addToast(t("shop.switched", { shop: branch.name }), "success");
    }
    onClose();
    navigate(`${base}/settings/roles`);
  }

  return (
    <Sheet open title={t("branches.editTitle")} onClose={onClose}>
      <div className="px-4 pt-1 pb-2" data-testid={`branch-edit-${branch.id}`}>
        {/* Which branch is being edited, said once, above the field the name goes in. */}
        <div className="flex items-center gap-2.5">
          <div
            className="size-9 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
            aria-hidden="true"
          >
            <Store size={17} />
          </div>
          <div className="min-w-0">
            <p className="text-14 font-bold truncate" style={{ color: "var(--text-primary)" }}>
              {branch.name}
            </p>
            <p className="text-11" style={{ color: "var(--text-secondary)" }}>
              {branch.isMain
                ? t("branches.mainNote")
                : t(branch.salesCount === 1 ? "branches.saleOne" : "branches.saleOther", {
                    count: String(branch.salesCount),
                  })}
            </p>
          </div>
        </div>

        {/* ── The name ──────────────────────────────────────────────────────────── */}
        <p className="text-12 font-semibold mt-4" style={{ color: "var(--text-primary)" }}>
          {t("branches.nameLabel")}
        </p>
        <div className="ds-field mt-2">
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null); }}
            onKeyDown={(e) => e.key === "Enter" && dirty && void handleSave()}
            maxLength={120}
            data-testid="branch-name-input"
            aria-label={t("branches.nameLabel")}
            className="h-full flex-1 bg-transparent outline-none ds-body text-start"
            style={{ color: "var(--text-primary)" }}
          />
        </div>
        {/* The refusal sits directly under the field it is about, not in a toast that has
            already faded by the time the person looks back at what they typed. */}
        {error && (
          <p className="text-11 mt-1.5" style={{ color: "var(--error)" }} data-testid="branch-name-error">
            {error}
          </p>
        )}

        {/* ── Where it is ───────────────────────────────────────────────────────── */}
        {/* Not a text field: a branch's location is a point on a map, and an address typed
            beside a pin is how the two end up describing different towns. */}
        <div className="mt-4">
          <LocationField
            value={place}
            onChange={setPlace}
            label={t("branches.locationLabel")}
            hint={t("location.notTyped")}
            testId={`branch-location-${branch.id}`}
          />
        </div>

        {/* ── Where farmers can find this branch ───────────────────────────────── */}
        {/* The branch's half of the marketplace decision. It sits right under the location
            because the two are read together: a farmer searches from their own point, so only
            a branch with one can be found at all. How far that search reaches is the farmer's
            choice, not this branch's — the database owns the one refusal left (listing
            without a location), and this reports what came back rather than deciding itself. */}
        <p className="text-12 font-semibold mt-4" style={{ color: "var(--text-primary)" }}>
          {t("marketplace.branchTitle")}
        </p>
        <div
          className="rounded-[var(--radius-card)] p-3.5 mt-2"
          style={{ background: "var(--tone-card)" }}
        >
          <div className="flex items-start gap-3">
            <button
              type="button"
              role="checkbox"
              aria-checked={marketplaceOn}
              aria-label={t("marketplace.branchToggle")}
              disabled={!canList}
              onClick={() => {
                setMarketError(null);
                setMarketplaceOn((v) => !v);
              }}
              data-testid={`branch-marketplace-toggle-${branch.id}`}
              className="mt-0.5 flex items-center justify-center shrink-0 disabled:opacity-50"
            >
              <Checkbox checked={marketplaceOn} disabled={!canList} />
            </button>
            <div className="min-w-0">
              <p className="text-14 font-bold" style={{ color: "var(--text-primary)" }}>
                {t("marketplace.branchToggle")}
              </p>
              <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>
                {hasPin ? t("marketplace.branchToggleHint") : t("marketplace.branchNoLocation")}
              </p>
            </div>
          </div>

          {marketError && (
            <p
              className="text-11 mt-2"
              style={{ color: "var(--error)" }}
              data-testid={`branch-marketplace-error-${branch.id}`}
            >
              {marketError}
            </p>
          )}
        </div>

        {/* ── The roles ─────────────────────────────────────────────────────────── */}
        <p className="text-12 font-semibold mt-4" style={{ color: "var(--text-primary)" }}>
          {t("branches.rolesTitle")}
        </p>

        {isActive && !rolesReady && (
          <div className="flex items-center justify-center py-5" role="status" aria-busy="true">
            <Loader2 size={18} className="animate-spin" style={{ color: "var(--text-secondary)" }} />
          </div>
        )}

        {isActive && rolesReady && roles.length > 0 && (
          <ListCard className="mt-2">
            {roles.map((role) => (
              <ListRow
                key={role.id}
                title={role.name}
                meta={t(
                  (counts[role.id] ?? 0) === 1 ? "branches.employeeOne" : "branches.employeeOther",
                  { count: String(counts[role.id] ?? 0) },
                )}
                onClick={() => void openRoles()}
              />
            ))}
          </ListCard>
        )}

        <p className="text-12 mt-2 leading-snug" style={{ color: "var(--text-secondary)" }}>
          {t("branches.rolesHint")}
        </p>

        <button
          type="button"
          onClick={() => void openRoles()}
          data-testid="branch-manage-roles"
          className="mt-2 h-10 px-1 flex items-center text-13 font-bold ds-pressable"
          style={{ color: "var(--brand-dark)" }}
        >
          {t("branches.manageRoles", { branch: branch.name })}
        </button>

        <Button
          fullWidth
          className="mt-4"
          loading={saving}
          disabled={!clean || !dirty}
          onClick={() => void handleSave()}
          testId="branch-save"
        >
          {saving ? t("branches.saving") : t("branches.save")}
        </Button>
      </div>
    </Sheet>
  );
}
