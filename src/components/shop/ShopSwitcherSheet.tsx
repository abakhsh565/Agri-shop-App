import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Check, Loader2, Plus } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import Button from "@/components/ui/Button";
import Checkbox from "@/components/ui/Checkbox";
import SuccessDialog from "@/components/ui/SuccessDialog";
import SetupChecklist from "@/components/ui/SetupChecklist";
import ShopSetupProgress from "@/components/shop/ShopSetupProgress";
import { useT } from "@/lib/i18n";
import { useShopStore, type ShopSummary } from "@/stores/shopStore";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { useRolesStore } from "@/stores/rolesStore";
import { useShellBase } from "@/lib/useShellBase";

/**
 * Setting up a shop is ONE job in three steps, and this is the whole of it.
 *
 * The flow used to be a name field bolted under the shop list: type a name, get a shop, and
 * then find out on your own that a shop with no roles and no stock cannot be handed to anyone.
 * The three steps are the job as it actually is — name it, decide who may do what, then do the
 * first three things a shop needs — and the sheet is where they run, because that is where
 * "which shop am I working in" already lives. Nothing opens a screen of its own: the steps
 * replace the list in place, with one bar band stating which step you are on, so the owner
 * cannot end up on a page with no way back to what they were doing.
 *
 * Two rules hold this together, and both are about NOT breaking the sequence:
 *
 *   1. The shop is written when step 2 is finished, with exactly the roles ticked there. That
 *      is the first moment the answer exists, and it is what makes step 3 real: a supplier
 *      created from step 3 belongs to a shop that is already there.
 *   2. Step 2 and step 3 both hand off to the screens this app already has — the role editor,
 *      the supplier form — and come BACK here, on the same step, with the new row already
 *      chosen or already ticked. The "come back" is `?setupFlow=N` in the URL: the sheet is
 *      mounted for the whole shell, so it reads which step it was on from the address and
 *      reopens itself, which survives an out-and-back trip that a local flag would not.
 *
 * The list itself is unchanged: the shops the account belongs to, with the current one marked,
 * read from the server on every open, and a switch decided by the server too. Nothing here
 * invents which shop is active.
 */

/** The steps of the flow, plus the list it starts from. */
type Step = "list" | 1 | 2 | 3;

export default function ShopSwitcherSheet() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const base = useShellBase();
  const { addToast } = useUIStore();

  const open = useShopStore((s) => s.switcherOpen);
  const close = useShopStore((s) => s.closeSwitcher);
  const openSheet = useShopStore((s) => s.openSwitcher);
  const shops = useShopStore((s) => s.shops);
  const activeShopId = useShopStore((s) => s.activeShopId);
  const loading = useShopStore((s) => s.loading);
  const loadError = useShopStore((s) => s.error);
  const switching = useShopStore((s) => s.switching);
  const creating = useShopStore((s) => s.creating);
  const load = useShopStore((s) => s.load);
  const switchTo = useShopStore((s) => s.switchTo);
  const create = useShopStore((s) => s.create);
  const switcherIntent = useShopStore((s) => s.switcherIntent);

  // Creating a shop is an owner/admin action at the database layer. The screen asks the same
  // question so an employee is not handed a button the server would refuse.
  const canCreate = useAuthStore((s) =>
    s.user?.membershipRole === "owner" ||
    s.user?.membershipRole === "admin" ||
    // An account with no membership yet still carries its shop-role: the server lets an admin
    // provision their first shop, and the flow must not hide the only way to do it.
    s.user?.role === "admin",
  );

  // ── The flow's own state ─────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("list");
  const [name, setName] = useState("");
  /** Which of this shop's roles the new one starts with. */
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set());
  // Whether the flow's closing confirmation is up. The step is left at 3 behind it, so the
  // popup is dismissing a finished job rather than replacing it.
  const [successOpen, setSuccessOpen] = useState(false);
  // Which row is mid-switch, so the spinner sits on the shop being opened rather than on the
  // one being left.
  const [pendingShopId, setPendingShopId] = useState<string | null>(null);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});

  const roles = useRolesStore((s) => s.roles);
  const rolesReady = useRolesStore((s) => s.ready);
  const loadRoles = useRolesStore((s) => s.load);
  const getRoleMemberCount = useRolesStore((s) => s.getRoleMemberCount);
  /**
   * The roles this step has already shown. A role that shows up LATER — one the owner just
   * created on the role screen and is now back from — is a new answer the owner asked for, so
   * it arrives ticked; a role that was here before keeps whatever the owner decided about it.
   * Re-ticking everything on every return would quietly undo an untick.
   */
  const knownRoleIds = useRef<Set<string>>(new Set());
  const flowSeeded = useRef(false);

  const shopName = useShopStore((s) => s.activeShopName) ?? "";

  /** The step the address says the flow is on, so an out-and-back trip restores it. */
  const flowStep = new URLSearchParams(location.search).get("setupFlow");

  /**
   * Where a create screen must come back to, carrying the step to reopen on.
   *
   * Built from the current address, so the owner is returned to the screen they were on and
   * not to Home: the sheet is mounted for the whole shell, so any admin screen can host it.
   * Read back by the effect below.
   */
  function returnPathTo(target: 2 | 3): string {
    const params = new URLSearchParams(location.search);
    params.set("setupFlow", String(target));
    return `${location.pathname}?${params.toString()}`;
  }

  // Fresh from the server on every open: a shop may have been created or joined on another
  // device since this one last looked.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  /**
   * Opened by an action that means "start a new one" — the Branches screen's create button.
   * The person asked for a new branch, not to browse the list, so the sheet opens straight
   * on the name step with a clean flow. The intent is cleared on the spot: it belongs to
   * this open only, and leaving it set would reopen the name step every time afterwards.
   */
  useEffect(() => {
    if (!open) return;
    if (switcherIntent !== "create") return;
    useShopStore.setState({ switcherIntent: "list" });
    flowSeeded.current = false;
    knownRoleIds.current = new Set();
    setName("");
    setSelectedRoleIds(new Set());
    setSuccessOpen(false);
    setStep(1);
  }, [open, switcherIntent]);

  /**
   * Coming back from a create screen: the address says which step, so reopen the sheet there.
   *
   * Deliberately does nothing when the parameter is absent — that is the state on the screen
   * the owner just went to, and closing the sheet on the way there was a decision, not an
   * accident to be undone.
   */
  useEffect(() => {
    if (flowStep !== "2" && flowStep !== "3") return;
    openSheet();
    setStep(flowStep === "2" ? 2 : 3);
  }, [flowStep, openSheet]);

  /** Entering step 2: this shop's roles, all of them ticked to begin with. */
  useEffect(() => {
    if (step !== 2) return;
    if (!rolesReady) void loadRoles();
  }, [step, rolesReady, loadRoles]);

  useEffect(() => {
    if (step !== 2 || !rolesReady) return;
    if (!flowSeeded.current) {
      flowSeeded.current = true;
      knownRoleIds.current = new Set(roles.map((r) => r.id));
      setSelectedRoleIds(new Set(roles.map((r) => r.id)));
      return;
    }
    const fresh = roles.filter((r) => !knownRoleIds.current.has(r.id));
    if (fresh.length === 0) return;
    for (const r of fresh) knownRoleIds.current.add(r.id);
    setSelectedRoleIds((prev) => new Set([...prev, ...fresh.map((r) => r.id)]));
  }, [step, rolesReady, roles]);

  // How many people each role already covers, so the row can say what the role is for in the
  // shop the owner is actually in.
  useEffect(() => {
    if (step !== 2 || roles.length === 0) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, number> = {};
      for (const role of roles) next[role.id] = await getRoleMemberCount(role.id);
      if (!cancelled) setMemberCounts(next);
    })();
    return () => { cancelled = true; };
  }, [step, roles, getRoleMemberCount]);

  const busy = switching || creating;

  function toggleRole(id: string) {
    setSelectedRoleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Hand the whole wizard off, and keep it: the name, the step and the selection all stay as
   * they are, because the flow is paused rather than finished. Closing the sheet is part of the
   * hand-off — the screen being opened is the point of it, and a sheet left up would cover it.
   */
  function handOff(to: string, state?: unknown) {
    close();
    navigate(to, state === undefined ? undefined : { state });
  }

  /** Leaving the flow for good: forget the step and take the marker out of the address. */
  function endFlow() {
    flowSeeded.current = false;
    knownRoleIds.current = new Set();
    setStep("list");
    setName("");
    setSelectedRoleIds(new Set());
    setSuccessOpen(false);
    close();
    const params = new URLSearchParams(location.search);
    if (params.has("setupFlow")) {
      params.delete("setupFlow");
      const qs = params.toString();
      navigate(`${location.pathname}${qs ? `?${qs}` : ""}`, { replace: true });
    }
  }

  function handleClose() {
    // A closed sheet is a declined flow, not a paused one — unless it is a hand-off, which
    // never comes through here.
    flowSeeded.current = false;
    knownRoleIds.current = new Set();
    setStep("list");
    setName("");
    setSelectedRoleIds(new Set());
    setPendingShopId(null);
    setSuccessOpen(false);
    close();
    const params = new URLSearchParams(location.search);
    if (params.has("setupFlow")) {
      params.delete("setupFlow");
      const qs = params.toString();
      navigate(`${location.pathname}${qs ? `?${qs}` : ""}`, { replace: true });
    }
  }

  async function handleSwitch(shop: ShopSummary) {
    if (busy || shop.id === activeShopId) return;
    setPendingShopId(shop.id);
    const result = await switchTo(shop.id);
    setPendingShopId(null);
    if (!result.ok) {
      addToast(
        t(result.code === "pending_sync" ? "shop.pendingSync" : "shop.switchFailed"),
        result.code === "pending_sync" ? "warning" : "error",
      );
      return;
    }
    // Closed rather than left open on the list: the screen behind it is already showing the
    // shop just opened, and the confirmation names it.
    handleClose();
    addToast(t("shop.switched", { shop: useShopStore.getState().activeShopName ?? "" }), "success");
  }

  /**
   * Step 2 finished: this is where the shop is written — with the name from step 1 and exactly
   * the roles ticked here. Everything the flow has collected exists as an answer at this
   * point, which is why it is written now and not at the end: step 3's supplier, product and
   * customer are real records, and a real record needs a shop to belong to.
   */
  async function handleCreate() {
    if (busy) return;
    const result = await create(name, Array.from(selectedRoleIds));
    if (!result.ok) {
      const message =
        result.code === "denied" ? t("shop.ownerOnly")
          : result.code === "name_required" ? t("shop.nameRequired")
            : t("shop.createFailed");
      addToast(message, "error");
      return;
    }
    // No toast here: the popup at the end of the flow is the confirmation, and two of them
    // for one action is noise. The new shop is already the active one (the server says so and
    // the store adopted it), so step 3 is looking at the right shop by the time it draws.
    setStep(3);
  }


  return (
    <>
      {/* The sheet carries no close cross: the list resolves in one tap, the scrim and the back
          button still dismiss it, and the steps carry their own Back. */}
      <Sheet open={open} title={t("shop.myShops")} onClose={handleClose} closeButton={false}>
        <div className="px-4 pt-1">
          {/* ── The list ─────────────────────────────────────────────────────────── */}
          {step === "list" && (
            <>
              {loading && shops.length === 0 && (
                <div className="flex items-center justify-center py-8" data-testid="shop-list-loading">
                  <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-secondary)" }} />
                </div>
              )}

              {/* Nothing to show, and the read FAILED: offer the read again rather than an empty
                  picker. */}
              {!loading && shops.length === 0 && loadError === "load_failed" && (
                <div className="flex flex-col items-center gap-3 py-8" data-testid="shop-list-failed">
                  <p className="ds-meta">{t("shop.loadFailed")}</p>
                  <Button variant="outline" size="sm" onClick={() => void load()}>
                    {t("common.tryAgain")}
                  </Button>
                </div>
              )}

              {/* Nothing to show, and the server answered: this account is in no shop. Reporting
                  a failed load here was false — nothing failed. */}
              {!loading && shops.length === 0 && loadError !== "load_failed" && (
                <div className="flex flex-col items-center gap-3 py-8" data-testid="shop-list-empty">
                  <p className="ds-meta text-center">{t(canCreate ? "shop.noneOwned" : "shop.noneMember")}</p>
                </div>
              )}

              {shops.length > 0 && (
                <ListCard>
                  {shops.map((shop) => {
                    const isCurrent = shop.id === activeShopId;
                    // A membership the database does not consider active cannot be worked in:
                    // offering it as a destination would switch the header and nothing else.
                    const usable = shop.membershipStatus === "active";
                    return (
                      <ListRow
                        key={shop.id}
                        title={shop.name}
                        meta={usable ? undefined : t("shop.notActive")}
                        testId={`shop-option-${shop.id}`}
                        emphasis
                        selected={isCurrent}
                        disabled={busy || !usable}
                        onClick={isCurrent || !usable ? undefined : () => void handleSwitch(shop)}
                        trailing={
                          pendingShopId === shop.id ? (
                            <Loader2
                              size={18}
                              className="animate-spin shrink-0"
                              style={{ color: "var(--brand-dark)" }}
                            />
                          ) : isCurrent ? (
                            <span className="flex items-center gap-1.5 shrink-0">
                              <span className="text-11 font-bold" style={{ color: "var(--brand-dark)" }}>
                                {t("shop.current")}
                              </span>
                              <Check size={18} style={{ color: "var(--brand-dark)" }} />
                            </span>
                          ) : undefined
                        }
                      />
                    );
                  })}
                </ListCard>
              )}

              {/* The way in, as a link under the list rather than a form sitting open in it:
                  "setup a new shop" is the start of a job, and the job has three steps. */}
              {canCreate && (
                <button
                  type="button"
                  onClick={() => {
                    // A flow that starts here starts clean, whatever an earlier attempt left.
                    flowSeeded.current = false;
                    knownRoleIds.current = new Set();
                    setName("");
                    setSelectedRoleIds(new Set());
                    setStep(1);
                  }}
                  data-testid="shop-setup-start"
                  className="mt-3 h-11 px-1 flex items-center gap-1 text-13 font-bold ds-pressable"
                  style={{ color: "var(--brand-dark)" }}
                >
                  {t("shop.createCta")} <span aria-hidden="true">&rsaquo;</span>
                </button>
              )}
            </>
          )}

          {/* ── Step 1 · the name ────────────────────────────────────────────────── */}
          {step === 1 && (
            <div data-testid="setup-step-1">
              <ShopSetupProgress step={1} />
              {/* What "setting up a shop" actually involves, said before the name is typed:
                  creating one opens an empty shop, and the work that follows is what the new
                  shop's Home lists. */}
              <p className="text-12 mt-2 leading-snug" style={{ color: "var(--text-secondary)" }}>
                {t("shop.createHint")}
              </p>
              <div className="ds-field mt-3">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && name.trim() && setStep(2)}
                  placeholder={t("shop.namePlaceholder")}
                  maxLength={60}
                  data-testid="shop-name-input"
                  aria-label={t("shop.nameLabel")}
                  className="h-full flex-1 bg-transparent outline-none ds-body text-start"
                  style={{ color: "var(--text-primary)" }}
                />
              </div>
              <Button
                fullWidth
                className="mt-3"
                disabled={name.trim().length === 0}
                onClick={() => setStep(2)}
                testId="setup-step-1-next"
              >
                {t("shop.createCta")}
              </Button>
              <button
                type="button"
                onClick={() => setStep("list")}
                data-testid="setup-back-1"
                className="mt-2 w-full h-10 text-12 ds-pressable"
                style={{ color: "var(--text-secondary)" }}
              >
                {t("setupFlow.back")}
              </button>
            </div>
          )}

          {/* ── Step 2 · which roles the shop starts with ────────────────────────── */}
          {step === 2 && (
            <div data-testid="setup-step-2">
              <ShopSetupProgress step={2} />
              <p className="text-12 mt-2 leading-snug" style={{ color: "var(--text-secondary)" }}>
                {t("setupFlow.rolesPick")}
              </p>

              {/* Roles being read for the first time. Said as a loading state rather than an
                  empty list, which would read as "this shop has no roles". */}
              {!rolesReady && (
                <div className="flex items-center justify-center py-8" role="status" aria-busy="true">
                  <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-secondary)" }} />
                </div>
              )}

              {rolesReady && roles.length === 0 && (
                <p className="text-12 mt-3 leading-snug" style={{ color: "var(--text-secondary)" }} data-testid="setup-roles-empty">
                  {t("setupFlow.rolesEmpty")}
                </p>
              )}

              {rolesReady && roles.length > 0 && (
                <ListCard className="mt-3">
                  {roles.map((role) => {
                    const on = selectedRoleIds.has(role.id);
                    const count = memberCounts[role.id];
                    return (
                      /* The row is a panel, not one big button: ticking and editing are two
                         different decisions, and a single tap target would have to pick one of
                         them. The box is the tick, "Modify" opens the role editor, and they sit
                         at the end of the row in that order — the tick last, where the eye
                         lands after reading what the role is. */
                      <ListRow
                        key={role.id}
                        testId={`wizard-role-${role.id}`}
                        trailing={
                          <div className="flex items-center gap-3 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                handOff(`${base}/settings/roles`, {
                                  setupFlow: { returnPath: returnPathTo(2), mode: "edit", roleId: role.id },
                                })
                              }
                              data-testid={`wizard-role-modify-${role.id}`}
                              className="text-12 font-bold ds-pressable"
                              style={{ color: "var(--brand-dark)" }}
                            >
                              {t("roles.modify")}
                            </button>
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={on}
                              aria-label={role.name}
                              onClick={() => toggleRole(role.id)}
                              data-testid={`wizard-role-toggle-${role.id}`}
                              className="flex items-center justify-center"
                            >
                              <Checkbox checked={on} />
                            </button>
                          </div>
                        }
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <p className="text-14 font-bold truncate" style={{ color: "var(--text-primary)" }}>
                              {role.name}
                            </p>
                            {role.isSystem && (
                              <span
                                className="text-11 px-2 py-0.5 rounded-full shrink-0 font-medium"
                                style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                              >
                                {t("roles.builtIn")}
                              </span>
                            )}
                          </div>
                          <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                            {t("roles.employees", { count: count ?? 0 })}
                            {role.permissionCount !== undefined &&
                              ` · ${t("roles.canDo", { count: role.permissionCount })}`}
                          </p>
                          {role.description && (
                            <p className="text-12 mt-1 leading-snug" style={{ color: "var(--text-secondary)" }}>
                              {role.description}
                            </p>
                          )}
                        </div>
                      </ListRow>
                    );
                  })}
                </ListCard>
              )}

              {/* The new-role screen this app already has, reached from here and returned
                  from — the flow is not a place to rebuild the role editor. */}
              <button
                type="button"
                onClick={() =>
                  handOff(`${base}/settings/roles`, {
                    setupFlow: { returnPath: returnPathTo(2), mode: "create" },
                  })
                }
                data-testid="setup-add-role"
                className="mt-3 h-11 px-1 flex items-center gap-1.5 text-13 font-bold ds-pressable"
                style={{ color: "var(--brand-dark)" }}
              >
                <Plus size={15} /> {t("setupFlow.addRole")}
              </button>

              <Button
                fullWidth
                className="mt-3"
                loading={creating}
                onClick={() => void handleCreate()}
                testId="setup-create-shop"
              >
                {creating ? t("shop.creating") : t("setupFlow.createShop")}
              </Button>
              <button
                type="button"
                onClick={() => setStep(1)}
                data-testid="setup-back-2"
                className="mt-2 w-full h-10 text-12 ds-pressable"
                style={{ color: "var(--text-secondary)" }}
              >
                {t("setupFlow.back")}
              </button>
            </div>
          )}

          {/* ── Step 3 · the first three things a shop needs ─────────────────────── */}
          {step === 3 && (
            <div data-testid="setup-step-3">
              <ShopSetupProgress step={3} />
              <p className="text-12 mt-2 leading-snug" style={{ color: "var(--text-secondary)" }}>
                {t("setupFlow.productsWhy")}
              </p>
              {/* The same checklist a new shop sees on Home — one derivation, one set of words,
                  one row per missing entity. It takes over the sheet's own content area rather
                  than being restyled, so a row that reads "Add supplier" here reads the same
                  there. */}
              <div className="mt-3">
                <SetupChecklist
                  testId="setup-flow-checklist"
                  returnTo={returnPathTo(3)}
                  onAction={(to) => handOff(to)}
                />
              </div>
              <Button fullWidth className="mt-3" onClick={() => setSuccessOpen(true)} testId="setup-finish">
                {t("setupFlow.continueToSetup")}
              </Button>
            </div>
          )}
        </div>
      </Sheet>

      {/* The end of the flow, confirmed — one mark, one sentence, one way on. */}
      <SuccessDialog
        open={successOpen}
        title={t("shop.createdTitle", { shop: shopName })}
        message={t("shop.createdBody", { shop: shopName })}
        confirmLabel={t("shop.createdDone")}
        onConfirm={endFlow}
      />
    </>
  );
}
