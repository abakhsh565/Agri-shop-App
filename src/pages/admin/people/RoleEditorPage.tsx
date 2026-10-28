import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Trash2 } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import PermissionChecklist, { useSelectAll } from "@/components/admin/PermissionChecklist";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useRolesStore } from "@/stores/rolesStore";
import { usePermissionsStore } from "@/stores/permissionsStore";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";

/**
 * One role, as its own screen: what it is called, what it opens, and the one destructive action.
 *
 * WHY A SCREEN RATHER THAN A SHEET. The role editor used to open over the list, which left the
 * forty-box checklist scrolling inside a panel while the list it belonged to sat dimmed behind
 * it. The owner's flow is now three separate, connected screens — the directory, the roles list,
 * and this editor — so opening a role is a step forward with a name in the bar and a Back that
 * returns to the list, and saving is a button at the foot of the screen rather than a sheet's
 * footer. Nothing about the permissions changed: the same codes are written through the same
 * `update_role` / `create_role` / `delete_role` RPCs, and the database still decides what any of
 * them allow.
 *
 * TWO THINGS THE SCREEN DOES NOT DO. It does not count or evaluate access by itself — the
 * checklist reads the permission catalogue and the role's grants from the stores, so the editor
 * and the rest of the app cannot disagree. And it does not silently open on an empty role: an
 * unfetched grant set and a role that grants nothing look identical in forty unticked boxes, so
 * the read has its own loading and failure states and Save stays disabled until it lands.
 *
 * The delete row is kept from the sheet, including its consequence sentence. Where the editor
 * was the list's sheet, `role-delete-row` is the anchor the delete lanes press, so the test ids
 * are the same ones those lanes already use.
 */
interface SetupFlowState {
  returnPath: string;
  mode: "create" | "edit";
  roleId?: string;
}

export default function RoleEditorPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const location = useLocation();
  const { roleId: param } = useParams<{ roleId: string }>();
  const { addToast } = useUIStore();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";

  // Whether the owner arrived from the shop-setup wizard, and where to hand them back to when
  // this editor is done. Absent on every ordinary visit from the roles list.
  const flow = (location.state as { setupFlow?: SetupFlowState } | null)?.setupFlow;

  const isNew = !param || param === "new";
  const roles = useRolesStore((s) => s.roles);
  const rolesReady = useRolesStore((s) => s.ready);
  const loadRoles = useRolesStore((s) => s.load);
  const loadRolePermissions = useRolesStore((s) => s.loadRolePermissions);
  const updateRole = useRolesStore((s) => s.updateRole);
  const createRole = useRolesStore((s) => s.createRole);
  const deleteRole = useRolesStore((s) => s.deleteRole);
  const getRoleMemberCount = useRolesStore((s) => s.getRoleMemberCount);
  const loadPermissions = usePermissionsStore((s) => s.load);

  const role = isNew ? null : roles.find((r) => r.id === param) ?? null;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // A new role starts from a real, empty answer; an existing one has to be read first, and
  // until that read lands its access is unknown — not empty.
  const [permsState, setPermsState] = useState<"loading" | "ready" | "error">(
    isNew ? "ready" : "loading",
  );
  const [formReady, setFormReady] = useState(isNew);
  const [memberCount, setMemberCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [nameError, setNameError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  // One hydration per role: the stores republish after every save, and re-running this would
  // overwrite what the owner is typing with the row that was last read.
  const hydrated = useRef<string | null>(null);

  const selectAll = useSelectAll(selected, setSelected);

  useEffect(() => {
    void loadRoles();
    void loadPermissions();
  }, [loadRoles, loadPermissions]);

  useEffect(() => {
    const key = isNew ? "new" : param ?? "";
    if (!key || hydrated.current === key) return;
    if (isNew) {
      hydrated.current = key;
      setFormReady(true);
      setPermsState("ready");
      return;
    }
    if (!role) return;
    hydrated.current = key;
    setName(role.name);
    setDescription(role.description ?? "");
    setFormReady(true);
    setPermsState("loading");
    void loadRolePermissions(role.id).then(({ codes, error }) => {
      if (error) {
        // Said out loud rather than shown as a role that grants nothing.
        setPermsState("error");
        return;
      }
      setSelected(new Set(codes));
      setPermsState("ready");
    });
    void getRoleMemberCount(role.id).then(setMemberCount);
  }, [isNew, param, role, loadRolePermissions, getRoleMemberCount]);

  /** The list the reader came from, unless the caller named a different return path. */
  function leave() {
    if (flow) {
      navigate(flow.returnPath, { replace: true });
      return;
    }
    navigate(`${base}/settings/roles`, { replace: true });
  }

  async function handleSave() {
    setNameError("");
    if (!name.trim()) {
      setNameError(t("roles.errName"));
      return;
    }
    if (savingRef.current || permsState !== "ready") return;
    savingRef.current = true;
    setSaving(true);
    try {
      const permissions = Array.from(selected);
      if (role) {
        await updateRole(role.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          permissions,
        });
        addToast(t("roles.updated"), "success");
      } else {
        await createRole({
          name: name.trim(),
          description: description.trim() || undefined,
          permissions,
        });
        addToast(t("roles.created"), "success");
      }
      leave();
    } catch (e) {
      addToast(e instanceof Error ? e.message : t("roles.errSave"), "error");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  /**
   * What deleting this role does, in the owner's words.
   *
   * `onRow` is the one-line form the row can actually show — a row's meta line truncates, and
   * a truncated sentence about who loses access is worse than a short one. The dialog gets the
   * full sentence, because that is the screen where the destructive decision is made.
   */
  function deleteConsequence(onRow = false): string {
    if (!role) return "";
    if (memberCount === 1) {
      // One person is the case where "1 employees" reads as a defect, and the sentence is the
      // one thing on this screen that explains what deleting does.
      return t(onRow ? "roles.deleteRevokesShortOne" : "roles.deleteRevokesOne");
    }
    if (memberCount > 1) {
      return t(onRow ? "roles.deleteRevokesShort" : "roles.deleteRevokes", { count: memberCount });
    }
    return t(role.isSystem ? "roles.deleteHintBuiltIn" : "roles.deleteHint", { name: role.name });
  }

  async function confirmDelete() {
    if (deletingRef.current || !role) return;
    deletingRef.current = true;
    setDeleting(true);
    try {
      await deleteRole(role.id);
      addToast(t("roles.deleted"), "success");
      setDeleteOpen(false);
      leave();
    } catch (e) {
      addToast(e instanceof Error ? e.message : t("common.error"), "error");
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  /** The two fields on this screen are the only things you type into, so their edge is the
   *  control token rather than the hairline a resting row uses. */
  const fieldStyle = {
    background: "var(--surface-2)",
    border: "1px solid var(--border-control)",
    color: "var(--text-primary)",
  } as const;

  const missing = rolesReady && !isNew && !role;
  const pageTitle = isNew ? t("roles.new") : role?.name ?? t("roles.edit");

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{
        background: "var(--background)",
        color: "var(--text-primary)",
        direction: isUrdu ? "rtl" : "ltr",
      }}
      data-testid="role-editor-page"
    >
      <StatusBar />
      <NavHeader
        title={pageTitle}
        backTo={flow ? flow.returnPath : `${base}/settings/roles`}
        onBack={flow ? () => navigate(flow.returnPath, { replace: true }) : undefined}
      />

      <div className="flex-1">
        <div className="px-4 pt-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-12" style={{ color: "var(--text-secondary)" }}>
              {isNew ? t("roles.newHint") : t("roles.intro")}
            </p>
            {role?.isSystem && (
              <span
                className="text-11 px-2 py-0.5 rounded-full font-medium shrink-0"
                style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
              >
                {t("roles.builtIn")}
              </span>
            )}
          </div>
          {role && (
            <p className="text-11 mt-1 tabular-nums" style={{ color: "var(--text-secondary)" }}>
              {t("roles.employees", { count: memberCount })}
            </p>
          )}
        </div>

        {missing && (
          <div className="px-4 pt-6" role="alert">
            <p className="text-13" style={{ color: "var(--text-secondary)" }}>
              {t("roles.notFound")}
            </p>
            <button
              type="button"
              onClick={leave}
              className="mt-3 h-10 px-4 rounded-full text-13 font-bold"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              {t("roles.backToList")}
            </button>
          </div>
        )}

        {!missing && !formReady && (
          <div className="px-4 pt-4">
            <SkeletonList rows={4} />
          </div>
        )}

        {!missing && formReady && (
          <>
            <div className="px-4 pt-4">
              <p className="text-11 font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                {t("roles.name")}
              </p>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("roles.nameHint")}
                data-testid="role-name"
                // A role's name is data, not interface copy: in Urdu the Latin name still reads
                // left to right, and `dir=auto` lets the field follow what was typed instead of
                // clipping the start of an English name against the right edge.
                dir="auto"
                autoFocus={isNew}
                className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
                style={fieldStyle}
              />
            </div>

            <div className="px-4 pt-3">
              <p className="text-11 font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                {t("roles.description")}
              </p>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("roles.descriptionHint")}
                data-testid="role-description"
                dir="auto"
                className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
                style={fieldStyle}
              />
            </div>

            {/* The heading row carries the one control that grants or clears everything — a
                pill on the heading's own line, above the groups rather than inside one. */}
            <div className="px-4 pt-5 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-11 font-medium" style={{ color: "var(--text-secondary)" }}>
                  {t("roles.access")}
                </p>
                <p className="text-11 mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                  {t("roles.permissionsHint")}
                </p>
              </div>
              <button
                type="button"
                onClick={selectAll.toggleAll}
                data-testid="role-select-all"
                disabled={permsState !== "ready"}
                className="h-7 px-3 rounded-full text-11 font-semibold shrink-0 disabled:opacity-50"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border-control)",
                  color: "var(--text-primary)",
                }}
              >
                {selectAll.allSelected ? t("roles.clearAll") : t("roles.selectAll")}
              </button>
            </div>

            {/* The access region is bounded, as it was in the sheet: forty boxes on one page
                would push the save button past the bottom of every phone. The page around it
                stays still, so the action that commits the role stays one small scroll away. */}
            {permsState === "error" ? (
              <div className="px-4 py-4">
                <p className="text-xs" style={{ color: "var(--error)" }} data-testid="role-perms-error">
                  {t("access.roleUnavailable")}
                </p>
                {role && (
                  <button
                    type="button"
                    onClick={() => {
                      setPermsState("loading");
                      void loadRolePermissions(role.id).then(({ codes, error }) => {
                        if (error) {
                          setPermsState("error");
                          return;
                        }
                        setSelected(new Set(codes));
                        setPermsState("ready");
                      });
                    }}
                    className="text-11 font-bold mt-2"
                    style={{ color: "var(--brand)" }}
                  >
                    {t("common.retry")}
                  </button>
                )}
              </div>
            ) : permsState === "ready" ? (
              <PermissionChecklist value={selected} onChange={setSelected} maxHeight="42vh" />
            ) : (
              <div className="px-4 py-4" role="status" aria-busy="true">
                <span className="sr-only">{t("access.loadingRole")}</span>
                <SkeletonList rows={3} bare />
              </div>
            )}

            {/* Removing a role, as a row of its own at the foot of the screen. It used to be an
                icon in a sheet's header, which is a place you only find if you already know it is
                there; here it is visible on every role, and when it cannot be removed the row
                says why in a sentence rather than doing nothing. */}
            {role && (
              <div className="px-4 pt-5" data-testid="role-delete">
                <ListCard>
                  <ListRow
                    danger
                    icon={Trash2}
                    onClick={() => setDeleteOpen(true)}
                    testId="role-delete-row"
                    title={t("roles.deleteAction")}
                    meta={deleteConsequence(true)}
                  />
                </ListCard>
              </div>
            )}

            <div className="pb-6" />
          </>
        )}
      </div>

      {!missing && formReady && (
        <div
          className="sticky bottom-0 px-4 pt-3 pb-4 flex flex-col gap-2"
          style={{ background: "var(--background)", borderTop: "1px solid var(--divider)" }}
        >
          {nameError && (
            <p className="text-xs" style={{ color: "var(--error)" }} data-testid="role-error">
              {nameError}
            </p>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || permsState !== "ready"}
            data-testid="role-save"
            className="w-full h-12 rounded-full font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            {saving ? t("common.saving") : role ? t("roles.update") : t("roles.create")}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={deleteOpen && role !== null}
        title={t("roles.deleteConfirm")}
        message={deleteConsequence()}
        confirmLabel={t("roles.deleteAction")}
        cancelLabel={t("common.cancel")}
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => !deleting && setDeleteOpen(false)}
      />
    </div>
  );
}
