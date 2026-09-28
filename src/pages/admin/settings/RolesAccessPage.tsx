import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Sheet from "@/components/ui/Sheet";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import PermissionChecklist, { useSelectAll } from "@/components/admin/PermissionChecklist";
import { useRolesStore } from "@/stores/rolesStore";
import { useShopStore } from "@/stores/shopStore";
import { useShellBase } from "@/lib/useShellBase";
import { usePermissionsStore } from "@/stores/permissionsStore";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { Plus, Trash2, ChevronRight } from "lucide-react";
import type { Role } from "@/types";

/**
 * Roles & Access — the templates the owner hands to employees.
 *
 * The list is the app's grouped grammar (one card, rows on the card's own tone), and editing
 * opens a sheet rather than replacing the screen: the list stays behind it, so changing a
 * role is a thing you do *to a list you can still see*, not a separate journey with its own
 * save button at the bottom of a page.
 *
 * Inside the sheet, access is a checklist — every actionable thing, one tick box each, grouped
 * by the part of the shop it belongs to — with a Select all for everything at the top and a
 * box on each group that grants or clears that group alone. The rule that enforces access has
 * not changed at all: the same permission codes are written to the same tables, and the
 * database still decides what any of them allow.
 *
 * ── Flow mode ──────────────────────────────────────────────────────────────────────
 * The shop-setup wizard's "Add New role" / "Modify" land here, because this IS the screen that
 * edits a role and rebuilding it inside a sheet would be a second role editor to keep in step.
 * In that mode the screen opens the editor for you and, the moment the editor is done with,
 * returns you to the wizard on the step you left — the sheet reopens itself from the address it
 * was handed (`?setupFlow=2`), with the role you just made already listed and ticked. Closing
 * the editor without saving returns you too: the wizard is a sequence, and leaving the owner
 * standing on the roles list after they came from step 2 is what breaks one.
 */
interface SetupFlowState {
  returnPath: string;
  mode: "create" | "edit";
  roleId?: string;
}
export default function RolesAccessPage() {
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { addToast } = useUIStore();
  // Whether this screen was opened BY the shop-setup wizard, and where to hand the owner back
  // to. Declared up here because the auto-open effect below is also part of the same arrival.
  const flow = (location.state as { setupFlow?: SetupFlowState } | null)?.setupFlow;
  // One auto-open per arrival: re-running it when the roles list reloads would reopen the
  // editor every time the store refreshes, which is what the ref is for.
  const flowOpened = useRef(false);
  const rolesStore = useRolesStore();
  const permissionsStore = usePermissionsStore();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [roleName, setRoleName] = useState("");
  const [roleDesc, setRoleDesc] = useState("");
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set());
  // A new role starts from a real, empty answer; an existing one has to be read first, and
  // until that read lands its access is unknown — not empty.
  const [permsState, setPermsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [saving, setSaving] = useState(false);
  // A ref, not `saving`: React batches, so two taps in one task both read the pre-render
  // `false` and both create the role. The state variable is only for the button's label.
  const savingRef = useRef(false);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  /** How much each role opens, as a number. The module NAMES were the confusing part:
   *  "Products · Purchases · Payments · Inven…" is a truncated line of database areas, not
   *  something an owner can act on, and it crowded the row it sat in. */
  const [rolePermCounts, setRolePermCounts] = useState<Record<string, number>>({});
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState(false);
  // A ref for the same reason as the employee screen: React batches, so two clicks in
  // one task would both read the pre-render value of `deleting` and both fire.
  const deletingRef = useRef(false);
  const [nameError, setNameError] = useState("");

  const selectAll = useSelectAll(selectedPerms, setSelectedPerms);

  /**
   * Arrived from the setup wizard: open the editor it asked for, once the roles are here.
   *
   * Waits for the list rather than opening on an empty one — the edit case needs the role to
   * exist before there is anything to edit, and the create case must not be pre-empted by a
   * skeleton.
   */
  useEffect(() => {
    if (!flow || flowOpened.current || !rolesStore.ready) return;
    if (flow.mode === "create") {
      flowOpened.current = true;
      startCreate();
      return;
    }
    const target = flow.roleId ? rolesStore.roles.find((r) => r.id === flow.roleId) : undefined;
    if (!target) return;
    flowOpened.current = true;
    startEdit(target);
  }, [flow, rolesStore.ready, rolesStore.roles]);

  const activeShopId = useShopStore((s) => s.activeShopId);
  const base = useShellBase();

  // Reload when the SHOP changes, not only on mount: the roles belong to one shop, and a list
  // left over from the previous one is not just stale, it is uneditable — the writes are
  // authorized against whichever shop the account is working in now.
  useEffect(() => {
    rolesStore.load();
    permissionsStore.load();
  }, [activeShopId]);

  // How many employees use each role, and which business areas it opens
  useEffect(() => {
    if (rolesStore.roles.length === 0) return;
    rolesStore.roles.forEach(async (role) => {
      const count = await rolesStore.getRoleMemberCount(role.id);
      setMemberCounts((prev) => ({ ...prev, [role.id]: count }));
      const perms = await rolesStore.getRolePermissions(role.id);
      setRolePermCounts((prev) => ({ ...prev, [role.id]: perms.length }));
    });
  }, [rolesStore.roles.length, permissionsStore.permissions.length]);

  function startCreate() {
    setEditingRole(null);
    setRoleName("");
    setRoleDesc("");
    setSelectedPerms(new Set());
    setNameError("");
    setPermsState("ready");
    setEditorOpen(true);
  }

  function startEdit(role: Role) {
    // A built-in role cannot be renamed or deleted, but the owner may still adjust what it
    // opens — and the fields that cannot change say so rather than accepting typing.
    setEditingRole(role);
    setRoleName(role.name);
    setRoleDesc(role.description ?? "");
    setNameError("");
    setSelectedPerms(new Set());
    setPermsState("loading");
    setEditorOpen(true);
    void loadPerms(role.id);
  }

  async function loadPerms(id: string) {
    const { codes, error } = await rolesStore.loadRolePermissions(id);
    if (error) {
      // Said out loud rather than shown as a role that grants nothing: the sheet opened on
      // forty empty boxes before, which is a claim about the role, not a loading state.
      setPermsState("error");
      return;
    }
    setSelectedPerms(new Set(codes));
    setPermsState("ready");
  }

  function closeEditor() {
    if (savingRef.current) return;
    setEditorOpen(false);
    setEditingRole(null);
    returnToFlow();
  }

  /**
   * Hand the owner back to the wizard they came from, on the step they left.
   *
   * `replace`, so the Back button does not walk them into the role sheet they just finished
   * with — the sequence they asked for is step 2, and that is where Back should lead.
   */
  function returnToFlow() {
    if (!flow) return;
    navigate(flow.returnPath, { replace: true });
  }

  async function handleSave() {
    setNameError("");
    if (!roleName.trim()) { setNameError(t("roles.errName")); return; }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const perms = Array.from(selectedPerms);
      if (editingRole) {
        await rolesStore.updateRole(editingRole.id, {
          name: roleName.trim(),
          description: roleDesc.trim() || undefined,
          permissions: perms,
        });
        addToast(t("roles.updated"), "success");
      } else {
        await rolesStore.createRole({
          name: roleName.trim(),
          description: roleDesc.trim() || undefined,
          permissions: perms,
        });
        addToast(t("roles.created"), "success");
      }
      setEditorOpen(false);
      setEditingRole(null);
      returnToFlow();
    } catch (e) {
      addToast(e instanceof Error ? e.message : t("roles.errSave"), "error");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  /**
   * A role that employees are still using cannot be deleted, and saying so is a business
   * explanation rather than a raw failure. Otherwise the owner confirms in the app's own
   * dialog, so the wording and the button order follow the language.
   */
  /**
   * Remove a role.
   *
   * One rule, for built-in and custom roles alike: nobody may be assigned to it. It used to
   * refuse every built-in role outright, which meant a shop that never used Inventory Clerk
   * had no way to remove it — "built-in" says where the role came from, not whether this shop
   * still wants it. The role can be created again with the same access, so the rule that
   * actually matter is kept: a role somebody is using is not deletable, and the screen says
   * which rule it hit.
   */
  function handleDelete(role: Role) {
    const count = memberCounts[role.id] ?? 0;
    if (count > 0) { addToast(t("roles.deleteBlocked", { count }), "error"); return; }
    setDeleteTarget(role);
  }

  /** Why this role cannot be removed, in the owner's words — empty when it can be. */
  function deleteBlockedReason(role: Role): string {
    const count = memberCounts[role.id] ?? 0;
    if (count > 0) return t("roles.deleteBlocked", { count });
    return "";
  }

  async function confirmDelete() {
    if (deletingRef.current || !deleteTarget) return;
    deletingRef.current = true;
    setDeleting(true);
    try {
      await rolesStore.deleteRole(deleteTarget.id);
      addToast(t("roles.deleted"), "success");
      if (editingRole?.id === deleteTarget.id) {
        setEditorOpen(false);
        setEditingRole(null);
      }
      setDeleteTarget(null);
    } catch (e) {
      addToast(e instanceof Error ? e.message : t("common.error"), "error");
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  /** The two fields in this sheet are the only things on it you type into, so their edge is
   *  the control token. Against the sheet's own tone `--divider` drew no edge at all, which is
   *  what made the sheet read as unlabelled lines of text rather than a form. */
  const fieldStyle = {
    background: "var(--surface-2)",
    border: "1px solid var(--border-control)",
    color: "var(--text-primary)",
  } as const;

  return (
    <div className="flex flex-col w-full min-h-full pb-20" style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}>
      <StatusBar />
      <NavHeader title={t("settings.rolesAccess")} />

      <div className="flex-1 px-4 pt-4">
        {/* The heading says what the screen is for, the count says how many there are, and the
            button is the one action on it. The count used to be a bare `Roles: 4` off to the
            left with nothing explaining it. */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className="text-14 font-bold" style={{ color: "var(--text-primary)" }}>
              {rolesStore.ready ? t("roles.count", { count: rolesStore.roles.length }) : ""}
            </p>
            <p className="text-11 mt-0.5 leading-snug" style={{ color: "var(--text-secondary)" }}>
              {t("roles.intro")}
            </p>
          </div>
          <button
            onClick={startCreate}
            data-testid="role-new"
            className="flex items-center gap-1.5 h-9 px-3.5 rounded-full text-13 font-bold shrink-0 ds-pressable"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            <Plus size={15} /> {t("roles.new")}
          </button>
        </div>

        {!rolesStore.ready && <SkeletonList rows={3} />}
        {rolesStore.ready && (
          <ListCard>
            {rolesStore.roles.map((role) => {
              const count = memberCounts[role.id] ?? 0;
              const permCount = rolePermCounts[role.id];
              return (
                <ListRow
                  key={role.id}
                  onClick={() => startEdit(role)}
                  testId={`role-${role.id}`}
                  trailing={<ChevronRight size={16} style={{ color: "var(--text-secondary)" }} />}
                >
                  {/* Name on the first line, at 14 and bold — the row's own reading order.
                      What used to be here: the name at 14 next to a description rendered
                      LARGER than the name, then a module list truncated mid-word
                      ("… · Payments · Inven…") and an "Employees: 0" label squeezed against
                      the chevron. Four sizes fighting on one row is what made the card look
                      unprofessional, so the facts are now stacked by importance: name, then
                      two counts, then what the role is for. */}
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
                    {t("roles.employees", { count })}
                    {permCount !== undefined && ` · ${t("roles.canDo", { count: permCount })}`}
                  </p>
                  {role.description && (
                    <p className="text-12 mt-1 leading-snug" style={{ color: "var(--text-secondary)" }}>
                      {role.description}
                    </p>
                  )}
                </ListRow>
              );
            })}
          </ListCard>
        )}
      </div>

      {/* ── The editor ─────────────────────────────────────────────────────────── */}
      <Sheet
        open={editorOpen}
        title={editingRole ? t("roles.edit") : t("roles.new")}
        onClose={closeEditor}
        /* No close cross: this sheet is opened by tapping a role and dismissed by the same
           gesture (the scrim, or Back). Two ways out, one of them a small target in the
           corner, is clutter on a screen whose own buttons are at the bottom. */
        closeButton={false}
        maxHeight="90vh"
      >
        <div className="px-4 flex flex-col gap-4">
          <div>
            <p className="text-11 font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
              {t("roles.name")}
            </p>
            <input
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              placeholder={t("roles.nameHint")}
              data-testid="role-name"
              autoFocus={!editingRole}
              className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
              style={fieldStyle}
            />
          </div>

          <div>
            <p className="text-11 font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
              {t("roles.description")}
            </p>
            <input
              value={roleDesc}
              onChange={(e) => setRoleDesc(e.target.value)}
              placeholder={t("roles.descriptionHint")}
              data-testid="role-description"
              className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
              style={fieldStyle}
            />
          </div>

          {/* The heading row carries the one control that grants or clears everything, the
              way the reference does — a pill on the heading's own line, above the groups
              rather than inside one of them. It was an underlined link, which read as a
              footnote to the list instead of a control on it. */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-11 font-medium" style={{ color: "var(--text-secondary)" }}>
              {t("roles.access")}
            </p>
            <button
              type="button"
              onClick={selectAll.toggleAll}
              data-testid="role-select-all"
              className="h-7 px-3 rounded-full text-11 font-semibold shrink-0"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--border-control)",
                color: "var(--text-primary)",
              }}
            >
              {selectAll.allSelected ? t("roles.clearAll") : t("roles.selectAll")}
            </button>
          </div>
        </div>

        {permsState === "error" ? (
          <div className="px-4 py-4">
            <p className="text-xs" style={{ color: "var(--error)" }} data-testid="role-perms-error">
              {t("access.roleUnavailable")}
            </p>
            {editingRole && (
              <button
                onClick={() => {
                  setPermsState("loading");
                  void loadPerms(editingRole.id);
                }}
                className="text-11 font-bold mt-2"
                style={{ color: "var(--brand)" }}
              >
                {t("common.retry")}
              </button>
            )}
          </div>
        ) : permsState === "ready" ? (
          <PermissionChecklist value={selectedPerms} onChange={setSelectedPerms} />
        ) : (
          <div className="px-4 py-4" role="status" aria-busy="true">
            <span className="sr-only">{t("access.loadingRole")}</span>
            <SkeletonList rows={3} bare />
          </div>
        )}

        {/* Removing a role, as a row of its own at the foot of the sheet.

            It was an icon in the sheet's header, which is a place you only find if you
            already know it is there — and for the four built-in roles it was not drawn at
            all, so the screen looked like it had no way to remove anything. Here it is
            visible on every role, and when it cannot be removed the row says why in a
            sentence rather than doing nothing. */}
        {editingRole && (
          <div className="px-4 pt-4" data-testid="role-delete">
            <ListCard>
              <ListRow
                danger
                icon={Trash2}
                disabled={Boolean(deleteBlockedReason(editingRole))}
                onClick={() => handleDelete(editingRole)}
                testId="role-delete-row"
                title={t("roles.deleteAction")}
                meta={
                  deleteBlockedReason(editingRole)
                  || t(editingRole.isSystem ? "roles.deleteHintBuiltIn" : "roles.deleteHint", { name: editingRole.name })
                }
              />
            </ListCard>
          </div>
        )}

        <div className="px-4 pt-4 flex flex-col gap-2">
          {nameError && (
            <p className="text-xs" style={{ color: "var(--error)" }} data-testid="role-error">{nameError}</p>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            data-testid="role-save"
            className="w-full h-12 rounded-full font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            {saving ? t("common.saving") : editingRole ? t("roles.update") : t("roles.create")}
          </button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("roles.deleteConfirm")}
        message={t(deleteTarget?.isSystem ? "roles.deleteHintBuiltIn" : "roles.deleteHint", { name: deleteTarget?.name ?? "" })}
        confirmLabel={t("roles.deleteAction")}
        cancelLabel={t("common.cancel")}
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => !deleting && setDeleteTarget(null)}
      />
    </div>
  );
}
