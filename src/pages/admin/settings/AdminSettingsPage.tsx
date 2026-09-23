import BusinessSettingsSheet from '@/components/ui/BusinessSettingsSheet';
import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import SetupProgress from "@/components/ui/SetupProgress";
import { useAuthStore } from "@/stores/authStore";
import { useThemeStore, applyTheme } from "@/stores/themeStore";
import { useUIStore } from "@/stores/uiStore";
import { clearDeviceSession } from "@/lib/deviceSession";
import { hasPin } from "@/lib/pinLock";
import { useT } from "@/lib/i18n";
import {
  Lock, Bell, Globe, ChevronRight, Moon, Sun,
  ClipboardList, Users, Package,
  Building2, ShieldCheck, Pencil, Loader2, Save, Wheat, LogOut, X,
} from "lucide-react";
import { uploadImage } from "@/lib/storage";
import { APP_NAME, APP_VERSION } from "@/lib/brand";
import { supabase } from "@/lib/supabase";

const LANG_LABELS: Record<string, string> = { en: "English", ur: "اردو" };

export default function AdminSettingsPage() {
  const navigate = useNavigate();
  const t = useT();
  const { addToast } = useUIStore();
  const { user, logout } = useAuthStore();
  const { theme, toggleTheme, language, setLanguage } = useThemeStore();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.photoUrl ?? null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editImageUrl, setEditImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showBusinessSettings, setShowBusinessSettings] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isUrdu = language === "ur";

  useEffect(() => { applyTheme(theme); }, []);

  function handleLogout() {
    if (user) clearDeviceSession(user.phone);
    logout();
    navigate("/login", { replace: true });
  }

  function cycleLanguage() {
    setLanguage(language === "en" ? "ur" : "en");
  }

  // The membership roles the data actually has: owner / admin / employee.
  const roleLabel =
    user?.membershipRole === "owner" ? t("settings.owner")
    : user?.membershipRole === "admin" ? t("emp.admin")
    : user ? t("search.employee") : "";

  function startEdit() {
    setEditName(user?.name ?? "");
    setEditImageUrl(user?.photoUrl ?? null);
    setEditing(true);
  }

  async function saveEdit() {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      // Saved with the signed-in session, and `.select()` is not decoration: RLS on
      // `users` filters the row, and PostgREST answers a filtered UPDATE with 204 — no
      // error. The previous anon-key PATCH therefore reported success, updated the local
      // store and closed the sheet while the database never changed, which is why a new
      // photo came back as the initials after a reload. Asking for the updated row back
      // turns that silent no-op into zero rows, which is a failure we can show.
      const { data, error } = await supabase
        .from("users")
        .update({ name: editName.trim(), photo_url: editImageUrl })
        .eq("id", user!.id)
        .select("id, name, photo_url");

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Profile update matched no rows (not saved)");
      }

      const saved = data[0];
      useAuthStore.getState().setUser({
        ...user!,
        name: saved.name ?? editName.trim(),
        photoUrl: saved.photo_url ?? undefined,
      });
      setAvatarUrl(saved.photo_url ?? null);
      setEditing(false);
    } catch (err) {
      console.error("Profile save failed:", err);
      addToast(t("copy.profileSaveFailed"), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage("employee-photos", file);
      setEditImageUrl(url);
    } catch (err) {
      // Was silent, so a failed upload looked like nothing happened at all.
      console.error("Avatar upload failed:", err);
      addToast(t("copy.profileSaveFailed"), "error");
    } finally {
      setUploading(false);
    }
  }

  const initials = user?.name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "OW";

  return (
    <div
      className="flex flex-col w-full min-h-full justify-between"
      style={{ background: "var(--background)", color: "var(--text-primary)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <div>
        <StatusBar />
        {/* Dismiss, not back: Settings is a destination you leave, so it carries a close
            cross on the trailing edge (the reference's own pattern) instead of a back arrow
            on the leading one. The hardware back button still works — nothing is trapped. */}
        <NavHeader
          title={t("settings.title") ?? "Profile & Settings"}
          noBack
          right={
            <button
              onClick={() => navigate("/admin/dashboard")}
              aria-label={t("common.close")}
              data-testid="settings-close"
              className="flex items-center justify-center size-8 rounded-full active:opacity-60"
            >
              <X size={18} style={{ color: "var(--text-primary)" }} />
            </button>
          }
        />

        {/* Profile card — the same card as the ones below it: `--radius-card` (not the
            row-tile radius), the grouped-list tone, and no drawn edge. The radius was 11px,
            the fill `--surface-2` and a 1px `--border-light` edge on top, which made the one
            card at the top of the page the only shape that did not match the cards under it. */}
        <div
          className="mx-4 mt-3.5 rounded-[var(--radius-card)] p-4 flex items-center gap-4 animate-fade-in-up"
          style={{ background: "var(--tone-card)" }}
        >
          <div className="relative shrink-0">
            <div
              className="w-12 h-12 rounded-full overflow-hidden flex items-center justify-center text-base font-bold"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              {avatarUrl
                ? <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                : initials
              }
            </div>
          </div>

          <div className="flex-1 min-w-0">
            {/* Name only. This card previously printed "Shop Owner" as the name, then
                "Shop owner" again underneath as the role, with an "Owner" chip beside the
                name — three statements of the same fact on a card whose job is to say who
                this account belongs to. The phone is the only line that adds anything. */}
            {/* Back to two lines: who the account is on the first, the number under it.
                Forcing both onto one line truncated the name to "Shop Own…" to make room for
                digits, which is the wrong way round — the name is what identifies the
                account, and the number has its own line to sit on. */}
            <div className="flex items-center gap-2 min-w-0">
              <p className="text-base font-bold truncate" style={{ color: "var(--text-primary)" }}>
                {user?.name}
              </p>
              {roleLabel && (
                <span
                  className="text-11 font-bold px-2 py-0.5 rounded-full shrink-0"
                  style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                >
                  {roleLabel}
                </span>
              )}
            </div>
            <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>{user?.phone}</p>
          </div>

          <button
            onClick={startEdit}
            className="flex items-center h-6.5 px-2.5 rounded-full text-12 font-bold shrink-0"
            style={{ background: "var(--surface)", color: "var(--text-secondary)", border: "1px solid var(--divider)" }}
          >
            {t("common.edit")}
          </button>
        </div>

        {/* Edit Profile Popup */}
        {editing && (
          <div
            className="fixed inset-0 z-50 flex items-end"
            style={{ background: "rgba(0,0,0,0.5)" }}
            onClick={() => setEditing(false)}
          >
            <div            className="w-full max-w-[390px] mx-auto rounded-t-[24px] p-6 flex flex-col gap-4"
            style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", borderBottom: "none" }}
            onClick={(e) => e.stopPropagation()}
          >
              {/* Handle bar */}
              <div className="flex justify-center mb-2">
                <div className="w-10 h-1 rounded-full" style={{ background: "var(--divider)" }} />
              </div>
              <p className="text-base font-bold text-center" style={{ color: "var(--text-primary)" }}>{t("common.edit")} {t("settings.profilePhoto")}</p>
              {/* Image upload in popup */}
              <div className="flex justify-center">
                <div className="relative">
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
                  <div
                    className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center text-xl font-bold cursor-pointer"
                    style={{ background: "var(--brand)", color: "#0a0a0a" }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : editImageUrl ? (
                      <img src={editImageUrl} alt="avatar" className="w-full h-full object-cover" />
                    ) : (
                      initials
                    )}
                  </div>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="account-badge"
                    className="absolute -bottom-1 -end-1 w-6 h-6 rounded-full flex items-center justify-center shadow"
                    style={{ background: "var(--brand)", color: "#0a0a0a" }}
                  >
                    <Pencil size={10} strokeWidth={2.5} />
                  </button>
                </div>
              </div>
              <div>
                <p className="ds-section-label mb-1.5" style={{ color: "var(--text-secondary)" }}>{t("common.name")}</p>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--border-control)", color: "var(--text-primary)", borderRadius: "24px" }}
                />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setEditing(false)} className="flex-1 h-12 rounded-full text-sm font-bold"
                  style={{ border: "1px solid var(--divider)", color: "var(--text-primary)" }}>{t("common.cancel")}</button>
                <button onClick={saveEdit} disabled={saving}
                  className="flex-1 h-12 rounded-full text-sm font-bold disabled:opacity-50"
                  style={{ background: "var(--brand)", color: "#0a0a0a" }}>{saving ? t("common.saving") : t("common.save")}</button>
              </div>
            </div>
          </div>
        )}

        {/* Business setup status. Persistent, not a one-time wizard: it shows what is done
            and what is missing, and disappears by itself once nothing is missing. It carries
            this page's own section markup, so it reads as one of the existing sections. */}
        <SetupProgress className="px-4 pt-3.5 animate-fade-in-up delay-75" />

        {/* Comfort first — no heading anywhere on this page.
            A heading earns its place only when a row could otherwise be misread; "Language"
            and "Dark Mode" cannot be, so they are simply the first block, above the work.
            The reference splits groups by whitespace alone, and state is carried as a quiet
            line under the label rather than a value pushed to the far right. */}
        <div className="px-4 pt-3.5 animate-fade-in-up delay-75">
          <ListCard>
            <ListRow
              onClick={cycleLanguage}
              icon={Globe}
              title={t("settings.language")}
              meta={LANG_LABELS[language]}
              trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
            />
            <ListRow
              onClick={toggleTheme}
              icon={theme === "dark" ? Moon : Sun}
              title={theme === "dark" ? t("settings.darkMode") : t("settings.lightMode")}
              trailing={
                <div
                  className="relative w-12 h-6 rounded-full transition-all duration-300 shrink-0"
                  style={{ background: theme === "dark" ? "var(--brand)" : "var(--muted)" }}
                >
                  <div
                    className="absolute top-1 w-4 h-4 rounded-full transition-all duration-300"
                    data-testid="theme-knob"
                    /* Logical inset: the knob travels from the inline start (off) to the
                       inline end (on), so the switch reads the same in Urdu as in English. */
                    style={{
                      insetInlineStart: theme === "dark" ? "calc(100% - 20px)" : "4px",
                      background: theme === "dark" ? "#0a0a0a" : "var(--text-secondary)",
                    }}
                  />
                </div>
              }
            />
            {[
              { icon: Lock,         label: user && hasPin(user.id) ? (t("settings.changePin") || "Change PIN") : (t("settings.setupPin") || "Setup PIN"),   action: () => navigate("/login/pin-set", { state: { returnTo: "/admin/settings" } }) },
              { icon: Bell,         label: t("settings.notifications"), action: () => navigate("/admin/notifications") },
              { icon: ClipboardList, label: t("settings.activityLog"), action: () => navigate("/admin/activity") },
            ].map((s) => {
              const Icon = s.icon;
              return (
                <ListRow
                  key={s.label}
                  onClick={s.action ?? undefined}
                  icon={Icon}
                  title={s.label}
                  // The primitive owns the trailing value and the chevron; a screen that
                  // wraps them in its own flex box restates the row's own geometry.
                  trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
                />
              );
            })}
          </ListCard>
        </div>

        {showBusinessSettings && <BusinessSettingsSheet onClose={() => setShowBusinessSettings(false)} onSave={() => {}} />}

        {/* The work — placed second because an owner opens Settings to run the shop, but
            under comfort because language and dark mode are changed far more often. No
            heading: the rows are self-evident, and the reference names nothing. */}
        <div className="px-4 pt-3.5 animate-fade-in-up delay-100">
          <ListCard>
            {[
              { icon: Users,       label: t("admin.employees") ?? "Employees",  action: () => navigate("/admin/employees") },
              { icon: ShieldCheck, label: t("settings.rolesAccess"),          action: () => navigate("/admin/settings/roles") },
              { icon: Building2,   label: t("admin.companies")  ?? "Companies", action: () => navigate("/admin/companies") },
              { icon: Package,     label: t("admin.inventory")  ?? "Inventory", action: () => navigate("/admin/products") },
            ].map((row) => {
              const Icon = row.icon;
              return (
                <ListRow
                  key={row.label}
                  onClick={row.action}
                  icon={Icon}
                  title={row.label}
                  trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
                />
              );
            })}
            {/* Crop configuration closes the work block: it is setup, not a daily task. */}
            <ListRow
              onClick={() => setShowBusinessSettings(true)}
              icon={Wheat}
              title={t("common.cropConfiguration")}
              meta={t("common.configureReminder")}
              trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
            />
          </ListCard>
        </div>

      </div>

      {/* One destructive row, alone, at the foot — the reference's shape. */}
      <div className="px-4 pt-3.5 pb-6 animate-fade-in-up delay-225">
        <ListCard>
          <ListRow
            danger
            onClick={handleLogout}
            icon={LogOut}
            title={t("settings.signOut")}
          />
        </ListCard>

        {/* What this build is. "Device / App Version" was a card of two rows that did
            nothing — an inventory app has no reason to tell a shop owner which handset
            they are on — so it is gone, and the version survives as the smallest text on
            the page, under the copyright, where every phone app puts it. */}
        <p className="text-11 mt-5 text-center" style={{ color: "var(--text-tertiary)" }}>
          © 2026 {APP_NAME} · v{APP_VERSION}
        </p>
      </div>
    </div>
  );
}
