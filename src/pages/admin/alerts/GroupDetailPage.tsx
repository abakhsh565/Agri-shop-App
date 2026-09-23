import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { formatCurrency } from "@/lib/formatters";
import { loadLocalGroups, deleteLocalGroup, updateLocalGroup } from "@/lib/localGroupRegistry";
import { Users, Trash2, ChevronLeft, Bell, MoreVertical } from "lucide-react";
import GroupReminderSheet from "@/components/ui/GroupReminderSheet";
import { SkeletonList } from "@/components/ui/Skeleton";

// Dictionary keys, not bilingual literals: these three concepts already have
// established wording used by the customer profile and the reminders overview, and
// a second wording here would be the same term said two ways on two screens.
const TRIGGER_KEYS: Record<string, string> = {
  before_due: "reminder.beforeDueDate",
  before_harvest: "reminder.beforeHarvest",
  after_credit: "reminder.afterCredit",
};

export default function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";

  const [group, setGroup] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    loadLocalGroups().then((groups) => {
      setGroup(groups.find((g: any) => g.id === groupId) || null);
      setLoading(false);
    });
  }, [groupId]);

  async function handleDelete() {
    if (!groupId) return;
    setDeleting(true);
    await deleteLocalGroup(groupId);
    navigate(-1);
  }

  if (loading) {
    // The group's customer list is a fetching list, so it waits in the shape it will
    // arrive in rather than behind a centred sentence that then turns into content.
    return (
      <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("inline.group_detail")} />
        <div className="pt-4">
          <SkeletonList rows={5} tile />
        </div>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("inline.group_detail_x")} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-13" style={{ color: "var(--text-secondary)" }}>
            {t("inline.group_not_found")}
          </p>
        </div>
      </div>
    );
  }

  const config = group.config;
  const triggerKey = TRIGGER_KEYS[config?.triggerType || "before_due"] ?? TRIGGER_KEYS.before_due;
  const activeCount = group.customers.filter((c: any) => c.outstandingBalance > 0).length;
  const completedCount = group.customers.filter((c: any) => c.outstandingBalance <= 0).length;

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}>
      <StatusBar />
      <NavHeader title={group.name} />
      <div className="flex flex-col px-4 pt-4 pb-8 gap-5">
        {/* Group identity */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0" style={{ background: "#ede9fe", color: "#7c3aed" }}>
            <Users size={22} />
          </div>
          <div className="flex-1">
            <p className="text-16 font-bold" style={{ color: "var(--text-primary)" }}>{group.name}</p>
            <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>
              {group.customerCount} {t("emp.customers")} · {activeCount} {t("inline.active")} · {completedCount} {t("inline.completed")}
            </p>
          </div>
          <div className="relative">
            <button onClick={() => setShowMenu(!showMenu)} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "var(--surface-2)" }}>
              <MoreVertical size={18} style={{ color: "var(--text-primary)" }} />
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                <div className="absolute end-0 top-full mt-1 z-50 w-[160px] rounded-[var(--radius-tile)] overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--divider)", boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>
                  <button onClick={() => { setShowMenu(false); setEditing(true); }} className="w-full flex items-center gap-2.5 px-4 py-3 text-13 font-medium" style={{ color: "var(--text-primary)" }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                    {t("customerProfile.edit")}
                  </button>
                  <button onClick={() => { setShowMenu(false); setShowDeleteConfirm(true); }} className="w-full flex items-center gap-2.5 px-4 py-3 text-13 font-medium" style={{ color: "#dc2626" }}>
                    <Trash2 size={15} />
                    {t("action.delete")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Reminder config */}
        <div className="rounded-[var(--radius-tile)] px-4 py-3 flex flex-col gap-2" style={{ background: "var(--surface-2)" }}>
          <div className="flex items-center gap-2">
            <Bell size={14} style={{ color: "var(--text-secondary)" }} />
            <p className="text-13 font-medium" style={{ color: "var(--text-primary)" }}>
              {t("inline.reminder_configuration")}
            </p>
          </div>
          <div className="flex flex-col gap-1.5 text-12" style={{ color: "var(--text-secondary)" }}>
            <p>
              <span className="font-medium">{t("inline.trigger")}:</span> {t(triggerKey)}{config?.startDays ? " \u2014 " + config.startDays + "d" : ""}
            </p>
            {config?.repeatType && config.repeatType !== "once" && (
              <p>
                <span className="font-medium">{t("reminder.repeat")}:</span> {config.intervalN} {config.intervalUnit === "days" ? (t("reminder.days")) : config.intervalUnit === "weeks" ? (t("reminder.weeks")) : (t("inline.months"))}
              </p>
            )}
            {config?.ends && (
              <p>
                <span className="font-medium">{t("reminder.ends")}:</span> {config.ends === "paid" ? (t("inline.when_paid_in_full")) : config.ends === "date" ? (t("inline.on_date")) : config.ends}
              </p>
            )}
          </div>
        </div>

        {/* Enrolled customers */}
        <div>
          <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
            {t("inline.enrolled_customers")}
          </p>
          <div>
            {group.customers.map((customer: any) => (
              <button
                key={customer.id}
                onClick={() => navigate("/admin/customers/" + customer.id)}
                className="w-full px-4 py-3.5 flex items-center gap-3 text-start transition-opacity active:opacity-70"
                style={{ borderBottom: "1px solid var(--divider)" }}
              >
                {customer.imageUrl ? (<img src={customer.imageUrl} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />) : (<div className="w-10 h-10 rounded-full flex items-center justify-center text-12 font-bold shrink-0" style={{ background: customer.outstandingBalance > 0 ? "#fee2e2" : "#d9f99d", color: customer.outstandingBalance > 0 ? "#dc2626" : "#3f6212" }}>{customer.name ? customer.name.charAt(0) : "?".toUpperCase()}</div>)}
                <div className="flex-1 min-w-0">
                  <p className="text-14 font-semibold truncate" style={{ color: "var(--text-primary)" }}>{customer.name}</p>
                  <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    {customer.outstandingBalance > 0
                      ? formatCurrency(customer.outstandingBalance) + " " + (t("customers.outstanding"))
                      : t("receipt.paid")}
                    {customer.dueDate ? " \u00b7 " + (t("inline.due_x")) + ": " + customer.dueDate : ""}
                  </p>
                </div>
                <ChevronLeft size={16} style={{ color: "var(--text-secondary)", transform: isUrdu ? "rotate(0)" : "rotate(180deg)" }} />
              </button>
            ))}
          </div>
        </div>


      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setShowDeleteConfirm(false)}>
          <div className="w-[300px] rounded-[var(--radius-card)] p-5 flex flex-col gap-4" style={{ background: "var(--tone-card)" }} onClick={(e) => e.stopPropagation()}>
            <p className="text-15 font-semibold" style={{ color: "var(--text-primary)" }}>{t("inline.delete_group")}</p>
            <p className="text-13" style={{ color: "var(--text-secondary)" }}>
              {t("inline.delete_group_warning", { name: group.name, count: group.customerCount })}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 h-10 rounded-full text-13 font-semibold" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                {t("common.cancel")}
              </button>
              <button onClick={handleDelete} disabled={deleting} className="flex-1 h-10 rounded-full text-13 font-semibold" style={{ background: "#dc2626", color: "#fff", opacity: deleting ? 0.6 : 1 }}>
                {deleting ? (t("inline.deleting")) : t("action.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Edit Group Sheet */}
      {editing && group && (
        <GroupReminderSheet
          config={group.config}
          selectedCustomerIds={group.customerIds}
          groupName={group.name}
          onSave={async (config, customerIds, name) => {
            await updateLocalGroup(group.id, config, customerIds, name);
            setEditing(false);
            // Reload
            const groups = await loadLocalGroups();
            const updated = groups.find((g: any) => g.id === group.id);
            if (updated) setGroup(updated);
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
