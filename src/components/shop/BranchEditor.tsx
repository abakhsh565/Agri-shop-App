import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
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
 * Everything a branch answers, in one form.
 *
 * This is the whole of a branch's configuration, as the page the Branches list opens. The
 * branch's identity and its figures are drawn ABOVE it by that page (`BranchIdentity`,
 * `BranchPerformance`), so the form begins where configuration begins and never repeats the
 * name and place it sits under.
 *
 * Editing a branch means everything that was answered when it was created. Creating a branch
 * collects two things: a name and which roles it starts with. Both are editable here, which is
 * the point the request makes about products: an input you can set but never change is not
 * management.
 *
 * The name is NOT edited here, and the roles are not either. The name is left alone because a
 * branch's name is its identity in every other screen — the switcher, the sales, the reports —
 * and this one is about where the branch is and whether farmers can find it; renaming from
 * beside the place map put a second, differently-scoped Edit on a screen that already had one.
 * The roles are a deliberate limit rather than a missing feature: a role belongs to the branch it
 * was created in, and this app's role screens — the list, the permission grid, the delete — are
 * all authorized against the branch the account is working in. Showing another branch's roles in
 * a form here and then having every save refused would be worse than saying where they are
 * edited. So for the branch you are standing in, the roles are listed with the number of people
 * on each and this form hands off to the real role screen; for any other branch the form names
 * where they live and offers to open it, stating the consequence it has — that opening it means
 * working in that branch.
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

export default function BranchEditor({
  branch,
  onClose,
}: {
  branch: BranchSummary;
  onClose: () => void;
  onRenamed: (name: string) => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const base = useShellBase();
  const { addToast } = useUIStore();

  const setBranchPlace = useShopStore((s) => s.setBranchPlace);
  const renameBranch = useShopStore((s) => s.renameBranch);
  const setMarketplaceSettings = useShopStore((s) => s.setMarketplaceSettings);
  const switchTo = useShopStore((s) => s.switchBranch);

  const roles = useRolesStore((s) => s.roles);
  const rolesReady = useRolesStore((s) => s.ready);
  const loadRoles = useRolesStore((s) => s.load);
  const getRoleMemberCount = useRolesStore((s) => s.getRoleMemberCount);

  const [name, setName] = useState(branch.name);
  /**
   * Where this branch is, as a point — read from the branch row, then picked on a map.
   *
   * Read rather than assumed: the form can be opened on a branch that has never had a location,
   * on one pinned last week, and everything in between, and "nothing here yet" must not look like
   * "somewhere else". Every change on this screen is written the moment it is made.
   *
   * It comes from the branch the screen handed in, NOT from a `shops` query of our own. `shops`
   * may only be read for the shop the account is working in, so querying it for any other branch
   * returned an empty result — not an error — and the field said "Choose on the map" about a
   * branch that was already pinned. `get_my_branches()` is the read allowed to see every branch
   * the account belongs to, so the place travels with the branch.
   */
  const [place, setPlace] = useState<PickedPlace | null>(branch.place);
  /** True while a write is on its way, so a second one cannot be queued behind it. */
  const [busy, setBusy] = useState(false);
  /** The question asked before the pin comes off, and the answer waiting on it. */
  const [askRemove, setAskRemove] = useState(false);
  /** A refused pin is reported where the picker is, not under a field it has nothing to do with. */
  const [locationError, setLocationError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  /**
   * The save guard is a ref, not `saving`.
   *
   * `saving` is a state variable, so it is still `false` for the second tap of a double
   * tap inside the same task — two saves would go out for one intention, and the second
   * could land after the form has closed. The ref is set synchronously, before anything
   * awaits, which is what actually stops the second one.
   */
  const savingRef = useRef(false);
  /**
   * This branch's marketplace decision, as it stands.
   *
   * It only moves when the database has accepted the move, so a refusal leaves the switch where it
   * was and says why underneath rather than reverting a choice the person made.
   *
   * The switch is the whole decision. There is no distance here, because how far a farmer is
   * willing to search from is the farmer's choice, made in the farmer app — a branch answers
   * only where it is.
   */
  const [marketplaceOn, setMarketplaceOn] = useState(branch.marketplaceEnabled);
  const [marketError, setMarketError] = useState<string | null>(null);

  // The branch being edited is the active one: its roles are the ones this app can read,
  // so they are what the form can list. Any other branch gets the sentence and the way in.
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

  const clean = branch.name.trim();
  // A farmer measures the distance from their own search point, so a branch that was never
  // pinned can never be found however close the search is; the switch refuses to turn ON
  // without a location. Turning it OFF is always allowed, whatever state it is in.
  const hasPin = place !== null;

  /**
   * Every change here is written the moment it is made.
   *
   * There is no Save button, and that is because there is nothing on this screen worth batching:
   * one place, one switch. A button over a single line edit asks the person to remember whether
   * they have unsaved work, and on a screen they came to READ the branch's state that question is
   * noise — what is on screen is what is stored. Each write reports its own refusal under the
   * thing it refused about, so nothing is quietly reverted behind the person's back.
   */
  async function writePlace(next: PickedPlace | null): Promise<boolean> {
    if (savingRef.current) return false;
    savingRef.current = true;
    setBusy(true);
    setLocationError(null);
    // Through `set_place` rather than a direct UPDATE: that is the one writer that knows a
    // location must be a point inside Pakistan, and it checks that the branch belongs to a tenant
    // the caller is a member of. It is also the writer that takes a pin back off, so removing a
    // location is a change like any other rather than a special case that writes nothing.
    const { error: placeError } = await supabase.rpc("set_place", {
      p_table: "branches",
      p_id: branch.id,
      p_latitude: next?.lat ?? null,
      p_longitude: next?.lng ?? null,
      p_label: next?.label ?? null,
      p_address: next?.address ?? null,
      p_source: next?.source ?? null,
    });
    savingRef.current = false;
    setBusy(false);
    if (placeError) {
      setLocationError(t("branches.locationFailed"));
      return false;
    }
    setPlace(next);
    // The list is what the next open of this page reads, so it is told now rather than after a
    // round trip: a pin that saved must not come back as the old one a moment later.
    setBranchPlace(branch.id, next);
    addToast(t("branches.saved", { branch: clean }), "success");
    return true;
  }

  /** The listing, written the same way, and refused here when there is no point to find it from. */
  async function writeMarket(next: boolean): Promise<boolean> {
    if (savingRef.current) return false;
    if (next && !hasPin) {
      setMarketError(t("marketplace.branchNoLocation"));
      return false;
    }
    savingRef.current = true;
    setBusy(true);
    setMarketError(null);
    const marketResult = await setMarketplaceSettings(branch.id, next);
    savingRef.current = false;
    setBusy(false);
    if (!marketResult.ok) {
      setMarketError(
        marketResult.code === "no_location" ? t("marketplace.branchNoLocation")
          : marketResult.code === "denied" ? t("marketplace.branchDenied")
            : t("marketplace.branchSaveFailed"),
      );
      return false;
    }
    setMarketplaceOn(next);
    addToast(t("branches.saved", { branch: clean }), "success");
    return true;
  }

  /**
   * Taking the pin off, once the question has been answered Yes.
   *
   * A word, not a cross: an unlabelled X beside the address reads as "delete this branch", the one
   * destructive action this screen must never look accidental about. A pin going also takes the
   * branch out of the marketplace — a farmer measures distance from a point, so a branch with none
   * can never be found however near the search is — and that write is made here too, visibly,
   * instead of leaving a listed branch that nothing can locate.
   */
  async function removeLocation() {
    if (!(await writePlace(null))) return;
    if (marketplaceOn) await writeMarket(false);
    setAskRemove(false);
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
    <div className="px-4 pt-1 pb-2" data-testid={`branch-edit-${branch.id}`}>
      {/* No identity block here: this form is hosted by the branch's own page, which opens with
          `BranchIdentity` and the branch's figures before the form begins. Said once, at the top
          of the page, rather than twice on one screen. */}
      <div className="ds-field"><input value={name} disabled={busy} maxLength={120}
        aria-label={t("branches.nameLabel")} onChange={(event) => setName(event.target.value)}
        className="h-full flex-1 bg-transparent outline-none ds-body text-start" /></div>
      <button type="button" disabled={busy || !name.trim() || name.trim() === branch.name}
        data-testid="branch-rename-save" className="h-10 text-12 font-semibold ds-pressable disabled:opacity-50"
        onClick={async () => {
          if (savingRef.current) return;
          savingRef.current = true; setBusy(true);
          try {
            const result = await renameBranch(branch.id, name);
            addToast(t(result.ok ? "branches.saved" : result.code === "name_taken" ? "branches.nameTaken" : "branches.saveFailed", { branch: name.trim() }), result.ok ? "success" : "error");
          } finally { savingRef.current = false; setBusy(false); }
        }}>{t("branches.save")}</button>
      {/* ── Where it is ───────────────────────────────────────────────────────── */}
      {/* Not a text field: a branch's location is a point on a map, and an address typed
          beside a pin is how the two end up describing different towns. */}
      <div className="mt-4">
        <LocationField
          pagePicker
          value={place}
          onChange={(next) => void writePlace(next)}
          label={t("branches.locationLabel")}
          testId={`branch-location-${branch.id}`}
          extraAction={
            hasPin ? (
              <button
                type="button"
                onClick={() => setAskRemove(true)}
                className="text-12 font-semibold ds-pressable"
                style={{ color: "var(--error)" }}
                data-testid={`branch-location-remove-${branch.id}`}
              >
                {t("branches.removeLocation")}
              </button>
            ) : null
          }
        />
      </div>
      {locationError && (
        <p className="text-11 mt-1.5" style={{ color: "var(--error)" }} data-testid="branch-location-error">
          {locationError}
        </p>
      )}
      {/* ── Where farmers can find this branch ───────────────────────────────── */}
      {/* The branch's half of the marketplace decision, as a bare checkbox. It sits right under
          the location because the two are read together: a farmer searches from their own
          point, so only a branch with one can be found at all. Checking it without a location
          is refused HERE with the instruction to add one — a disabled control that explains
          nothing would say the same thing less usefully. How far a search reaches stays the
          farmer's choice, not this branch's. */}
      <p className="text-14 font-bold mt-4" style={{ color: "var(--text-primary)" }}>
        {t("marketplace.branchTitle")}
      </p>
      <button
        type="button"
        role="checkbox"
        aria-checked={marketplaceOn}
        aria-label={t("marketplace.branchToggle")}
        disabled={busy}
        onClick={() => void writeMarket(!marketplaceOn)}
        data-testid={`branch-marketplace-toggle-${branch.id}`}
        className="mt-2.5 flex items-center gap-3 text-start ds-pressable disabled:opacity-50"
      >
        <span className="flex items-center justify-center shrink-0">
          <Checkbox checked={marketplaceOn} size={22} />
        </span>
        <span className="text-12 font-semibold" style={{ color: "var(--text-primary)" }}>
          {branch.isCurrent
            ? marketplaceOn
              ? t("marketplace.branchToggleNotice")
              : t("marketplace.branchToggleOffNotice")
            : t("marketplace.branchToggleNotice")}
        </span>
      </button>

      {marketError && (
        <p
          className="text-11 mt-2"
          style={{ color: "var(--error)" }}
          data-testid={`branch-marketplace-error-${branch.id}`}
        >
          {marketError}
        </p>
      )}

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

      {/*
        The one question this screen asks, and it is asked before anything is lost: a branch's
        location is the whole of what a farmer can search from, so taking it off is a decision
        rather than a stray tap — and the answer is a word, not a cross in the address line.
      */}
      <ConfirmDialog
        open={askRemove}
        title={t("branches.removeLocationTitle")}
        message={t("branches.removeLocationBody")}
        confirmLabel={t("branches.removeLocationYes")}
        destructive
        loading={busy}
        onConfirm={() => void removeLocation()}
        onCancel={() => setAskRemove(false)}
      />
    </div>
  );
}
