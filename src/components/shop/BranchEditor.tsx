import { useEffect, useRef, useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import LocationField from "@/components/ui/LocationField";
import Checkbox from "@/components/ui/Checkbox";
import { supabase } from "@/lib/supabase";
import type { PickedPlace } from "@/lib/geo";
import { useT } from "@/lib/i18n";
import { useShopStore, type BranchSummary } from "@/stores/shopStore";
import { useUIStore } from "@/stores/uiStore";

/**
 * The two things a branch answers about itself: where it is, and whether farmers nearby can find
 * it. Everything else on this page belongs to another section and is drawn there.
 *
 * WHAT MOVED OUT (owner's redesign, 2026-11-12). The roles list used to live here, with a heading,
 * a per-role count and its own explanation of which branch's roles could be read. That made the
 * page describe the same people three times — responsible person, co-owner and roles — in three
 * separately titled blocks with a sentence each. Roles are now one row in the page's People
 * section, and this form is only what it edits.
 *
 * NO SENTENCES THAT ONLY EXPLAIN THE DESIGN. The marketplace block used to repeat the branch's
 * location in prose ("only a branch with a location can be found"), because the pin sat above it.
 * It is now one row: the decision's name, the state it is in, and the box. A refusal is still
 * reported where it was made — under the row — because that one is about what just happened, not
 * about how the screen works.
 *
 * Every change is written the moment it is made. There is no Save button, and that is because
 * there is nothing here worth batching: one place, one switch. What is on screen is what is
 * stored, and each write reports its own refusal under the thing it refused about.
 */

export default function BranchEditor({ branch }: { branch: BranchSummary }) {
  const t = useT();
  const { addToast } = useUIStore();

  const setBranchPlace = useShopStore((s) => s.setBranchPlace);
  const setMarketplaceSettings = useShopStore((s) => s.setMarketplaceSettings);
  const loadBranches = useShopStore((s) => s.loadBranches);

  /**
   * Where this branch is, as a point — read from the branch row, then picked on a map.
   *
   * Read rather than assumed: the form can be opened on a branch that has never had a location,
   * on one pinned last week, and everything in between, and "nothing here yet" must not look like
   * "somewhere else".
   */
  const [place, setPlace] = useState<PickedPlace | null>(branch.place);
  /** True while a write is on its way, so a second one cannot be queued behind it. */
  const [busy, setBusy] = useState(false);
  /** The question asked before the pin comes off, and the answer waiting on it. */
  const [askRemove, setAskRemove] = useState(false);
  /** A refused pin is reported where the picker is, not under a field it has nothing to do with. */
  const [locationError, setLocationError] = useState<string | null>(null);
  /**
   * The save guard is a ref, not `busy`: `busy` is state and is still `false` for the second tap of
   * a double tap inside one task, so two writes would go out for one intention.
   */
  const savingRef = useRef(false);
  /** This branch's marketplace decision, as it stands — it only moves once the database accepts it. */
  const [marketplaceOn, setMarketplaceOn] = useState(branch.marketplaceEnabled);
  const [marketError, setMarketError] = useState<string | null>(null);

  // A farmer measures the distance from their own search point, so a branch that was never pinned
  // can never be found however close the search is; the switch refuses to turn ON without a
  // location. Turning it OFF is always allowed, whatever state it is in.
  const hasPin = place !== null;

  async function writePlace(next: PickedPlace | null): Promise<boolean> {
    if (savingRef.current) return false;
    savingRef.current = true;
    setBusy(true);
    setLocationError(null);
    try {
      // Through `set_place` rather than a direct UPDATE: that is the one writer that knows a
      // location must be a point inside Pakistan, and it takes a pin back off too.
      const { error: placeError } = await supabase.rpc("set_place", {
        p_table: "branches",
        p_id: branch.id,
        p_latitude: next?.lat ?? null,
        p_longitude: next?.lng ?? null,
        p_label: next?.label ?? null,
        p_address: next?.address ?? null,
        p_source: next?.source ?? null,
      });
      if (placeError) {
        setLocationError(t("branches.locationFailed"));
        return false;
      }
      setPlace(next);
      // The list is what the next open of this page reads, so it is told now rather than after
      // a round trip: a pin that saved must not come back as the old one a moment later.
      setBranchPlace(branch.id, next);
      addToast(t("branches.saved", { branch: branch.name }), "success");
      return true;
    } catch {
      setLocationError(t("branches.locationFailed"));
      return false;
    } finally {
      // Always released. A rejected request that left `busy` set disabled the row for the rest
      // of the visit, so the control looked like it did nothing at all.
      savingRef.current = false;
      setBusy(false);
    }
  }

  /** The listing, written the same way, and refused here when there is no point to find it from. */
  async function writeMarket(next: boolean): Promise<boolean> {
    if (savingRef.current) return false;
    if (next && !hasPin) {
      setMarketError(t("marketplace.branchNoLocation"));
      addToast(t("marketplace.branchNoLocation"), "warning");
      return false;
    }
    savingRef.current = true;
    setBusy(true);
    setMarketError(null);
    try {
      const marketResult = await setMarketplaceSettings(branch.id, next);
      if (!marketResult.ok) {
        const message =
          marketResult.code === "no_location" ? t("marketplace.branchNoLocation")
            : marketResult.code === "denied" ? t("marketplace.branchDenied")
              : t("marketplace.branchSaveFailed");
        setMarketError(message);
        // Also said out loud: a refusal that only appears as small text under the row reads as
        // a toggle that did not move.
        addToast(message, "error");
        return false;
      }
      setMarketplaceOn(next);
      // The listing is a business setting the branch row only reflects, so the row is re-read
      // from the server instead of trusting the value we sent. Without this the box could spring
      // back to the old state on the next load and look broken.
      await loadBranches();
      addToast(t("branches.saved", { branch: branch.name }), "success");
      return true;
    } catch {
      const message = t("marketplace.branchSaveFailed");
      setMarketError(message);
      addToast(message, "error");
      return false;
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  }

  /**
   * Taking the pin off, once the question has been answered Yes.
   *
   * A word, not a cross: an unlabelled X beside the address reads as "delete this branch". A pin
   * going also takes the branch out of the marketplace, and that write is made here too,
   * visibly, instead of leaving a listed branch that nothing can locate.
   */
  async function removeLocation() {
    if (!(await writePlace(null))) return;
    if (marketplaceOn) await writeMarket(false);
    setAskRemove(false);
  }

  // The page's own gutter. Every block on this record — the plate above, this form, the People
  // list and the archive action — shares one 16px inset, so the location card cannot sit wider
  // than the figures it describes (owner, 2026-11-12).
  return (
    <div className="px-4" data-testid={`branch-edit-${branch.id}`}>
      {/* Not a text field: a branch's location is a point on a map, and an address typed beside a
          pin is how the two end up describing different towns. */}
      <div className="pt-4">
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

      {/* The decision and the state it is in, as one row: the name says what it is, the second
          line says whether it is on, the box is the control. */}
      <button
        type="button"
        role="checkbox"
        aria-checked={marketplaceOn}
        aria-label={t("marketplace.branchToggle")}
        disabled={busy}
        onClick={() => void writeMarket(!marketplaceOn)}
        data-testid={`branch-marketplace-toggle-${branch.id}`}
        className="w-full flex items-center gap-3 py-3.5 mt-2 text-start ds-pressable disabled:opacity-50"
        style={{ borderTop: "1px solid var(--hairline)" }}
      >
        <span className="min-w-0 flex-1">
          <span className="text-15 font-semibold block">{t("marketplace.branchTitle")}</span>
          <span className="text-13 block mt-1" style={{ color: "var(--text-secondary)" }}>
            {marketplaceOn ? t("marketplace.branchToggleNotice") : t("marketplace.branchToggleOffNotice")}
          </span>
        </span>
        <Checkbox checked={marketplaceOn} size={22} />
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

      {/* The one question this screen asks, and it is asked before anything is lost. */}
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
