import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useAuthStore } from "@/stores/authStore";
import { useThemeStore, applyTheme } from "@/stores/themeStore";
import { clearDeviceSession } from "@/lib/deviceSession";
import { hasPin } from "@/lib/pinLock";
import { useT } from "@/lib/i18n";
import { uploadImage } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import { useUIStore } from "@/stores/uiStore";
import { Lock, Bell, Globe, Info, ChevronRight, Moon, Sun, ClipboardList, Smartphone, Camera, Loader2, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNotificationStore } from "@/stores/notificationStore";

const LANG_LABELS: Record<string, string> = { en: "English", ur: "اردو" };

export default function SettingsPage() {
  const navigate = useNavigate();
  const t = useT();
  const { user, logout } = useAuthStore();
  const { theme, toggleTheme, language, setLanguage } = useThemeStore();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.photoUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(user?.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useUIStore();

  async function handleSaveName() {
    if (!nameValue.trim() || !user) return;
    setSavingName(true);
    try {
      const { error } = await supabase.from("users").update({ name: nameValue.trim() }).eq("id", user.id);
      if (error) throw error;
      useAuthStore.getState().setUser({ ...user, name: nameValue.trim() });
      setEditingName(false);
      addToast("Name updated", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to update name", "error");
      setNameValue(user.name);
    } finally {
      setSavingName(false);
    }
  }

  // Apply stored theme on mount
  useEffect(() => { applyTheme(theme); }, []);

  function handleLogout() {
    if (user) clearDeviceSession(user.phone);
    logout();
    navigate("/login", { replace: true });
  }

  function cycleLanguage() {
    setLanguage(language === "en" ? "ur" : "en");
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    // Show instant preview
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarUrl(ev.target?.result as string);
    reader.readAsDataURL(file);
    // Upload to Supabase Storage
    setUploading(true);
    try {
      const url = await uploadImage("employee-photos", file);
      // Persist to users.photo_url in Supabase
      const { error } = await supabase.from("users").update({ photo_url: url }).eq("id", user.id);
      if (error) throw error;
      // Update auth store so dashboard shows the new photo
      useAuthStore.getState().setUser({ ...user, photoUrl: url });
      setAvatarUrl(url);
      addToast("Profile photo updated", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Upload failed", "error");
      setAvatarUrl(user.photoUrl ?? null);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const initials = user?.name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "?";

  return (
    <div
      className="settings-compact flex flex-col w-full min-h-full justify-between"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
    >
      <div>
        <StatusBar />
        <NavHeader title={t("settings.title")} />

        {/* Profile card — the same card as the ones below it: `--radius-card`, the
            grouped-list tone, and no drawn edge (see the admin twin, which carries the
            same fix). */}
        <div
          className="mx-4 mt-3 rounded-[var(--radius-card)] p-4 flex items-center gap-4 animate-fade-in-up"
          style={{ background: "var(--tone-card)" }}
        >
          {/* Avatar */}
          <div className="relative shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
            <div
              className="w-12 h-12 rounded-full overflow-hidden flex items-center justify-center text-base font-bold"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              {uploading ? (
                <Loader2 size={20} className="animate-spin" />
              ) : avatarUrl ? (
                <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                initials
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-base font-bold truncate" style={{ color: "var(--text-primary)" }}>
                {user?.name}
              </p>
              <button
                onClick={() => setEditingName(true)}
                className="flex items-center h-6.5 px-2.5 rounded-full text-12 font-bold shrink-0"
                style={{ background: "var(--surface)", color: "var(--text-secondary)", border: "1px solid var(--divider)" }}
              >
                {t("common.edit")}
              </button>
            </div>
            <p className="text-10 mt-0.5" style={{ color: "var(--text-secondary)" }}>
              {user?.membershipRole === "owner" ? t("settings.owner") : t("search.employee")}
              {user?.employeeNumber ? ` · ${t("empDetail.number")} ${user.employeeNumber}` : ""}
            </p>
            <p className="text-10" style={{ color: "var(--text-secondary)" }}>{user?.phone}</p>
          </div>
        </div>

        {/* Appearance */}
        <div className="px-4 pt-5 animate-fade-in-up delay-75">
          <p className="text-xs font-bold uppercase mb-3 tracking-wider" style={{ color: "var(--text-secondary)" }}>
            {t("settings.appearance")}
          </p>
          <ListCard>
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
                    style={{
                      left: theme === "dark" ? "calc(100% - 20px)" : "4px",
                      background: theme === "dark" ? "#0a0a0a" : "var(--text-secondary)",
                    }}
                  />
                </div>
              }
            />
            <ListRow
              onClick={cycleLanguage}
              icon={Globe}
              title={t("settings.language")}
              trailing={
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className="text-xs font-bold px-3 py-1 rounded-full"
                    style={{ background: "var(--brand)", color: "#0a0a0a" }}
                  >
                    {LANG_LABELS[language]}
                  </span>
                  <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />
                </div>
              }
            />
          </ListCard>

          {/* Urdu notice */}
          {language === "ur" && (
            <div
              className="mt-2 px-4 py-3 rounded-[var(--radius-tile)] text-end text-sm animate-fade-in-up"
              style={{ background: "rgba(132,204,22,0.1)", color: "var(--brand-dark)", direction: "rtl" }}
            >
              اردو زبان فعال ہے۔ یہ ایپ دو زبانوں میں کام کرتی ہے۔
            </div>
          )}
        </div>

        {/* Account */}
        <div className="px-4 pt-5 animate-fade-in-up delay-150">
          <p className="text-xs font-bold uppercase mb-3 tracking-wider" style={{ color: "var(--text-secondary)" }}>
            {t("settings.account")}
          </p>
          <ListCard>
            {[
              {
                icon: Lock,
                label: user && hasPin(user.id) ? (t("settings.changePin") || "Change PIN") : (t("settings.setupPin") || "Setup PIN"),
                right: null, action: () => navigate("/login/pin-set", { state: { returnTo: "/employee/settings" } }),
              },
              {
                icon: Bell, label: t("settings.notifications"),
                right: null, action: () => navigate("/employee/notifications"),
                badge: useNotificationStore.getState().unread(),
              },
              {
                icon: ClipboardList, label: t("settings.activityLog"),
                right: null, action: () => navigate("/employee/activity"),
              },
              {
                icon: Smartphone, label: t("settings.device"),
                right: t("settings.thisPhone") || "This Phone", action: null,
              },
              {
                icon: Info, label: t("settings.appVersion"),
                right: "1.0.0", action: null,
              },
            ].map((s) => {
              const Icon = s.icon;
              return (
                <ListRow
                  key={s.label}
                  onClick={s.action ?? undefined}
                  icon={Icon}
                  title={s.label}
                  trailing={
                    <div className="flex items-center gap-1 shrink-0">
                      {'badge' in s && s.badge ? (
                        <span className="text-10 font-bold px-1.5 py-0.5 rounded-full" style={{ background: "#ef4444", color: "#fff" }}>
                          {s.badge}
                        </span>
                      ) : s.right ? (
                        <span className="text-10" style={{ color: "var(--text-secondary)" }}>{s.right}</span>
                      ) : null}
                      {s.action && <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />}
                    </div>
                  }
                />
              );
            })}
          </ListCard>
        </div>
      </div>

      {/* Edit Profile Bottom Sheet */}
      {editingName && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => { setEditingName(false); setNameValue(user?.name ?? ""); }}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-md rounded-t-[24px] p-6 pb-8 animate-slide-up"
            style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", borderBottom: "none" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle bar */}
            <div className="flex justify-center mb-4">
              <div className="w-10 h-1 rounded-full" style={{ background: "var(--divider)" }} />
            </div>
            <p className="text-base font-bold text-center mb-5" style={{ color: "var(--text-primary)" }}>{t("common.edit")}</p>
            {/* Photo in popup */}
            <div className="flex flex-col items-center mb-5">
              <div className="relative">
                <div className="w-20 h-20 rounded-full overflow-hidden flex items-center justify-center text-2xl font-bold" style={{ background: "var(--brand)", color: "#0a0a0a" }}>
                  {avatarUrl ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" /> : initials}
                </div>
                <button
                  onClick={() => { setEditingName(false); fileInputRef.current?.click(); }}
                  className="absolute -bottom-1 -end-1 w-7 h-7 rounded-full flex items-center justify-center shadow"
                  style={{ background: "var(--brand)", color: "#0a0a0a" }}
                >
                  <Camera size={13} strokeWidth={2.5} />
                </button>
              </div>
            </div>
            {/* Name input */}
            <div className="mb-5">
              <label className="text-11 font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: "var(--text-secondary)" }}>{t("addCustomer.name")}</label>
              <input
                autoFocus
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveName(); }}
                className="w-full h-12 px-4 rounded-full text-sm font-bold outline-none"
                style={{ background: "var(--surface)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setEditingName(false); setNameValue(user?.name ?? ""); }}
                className="flex-1 h-12 rounded-full text-sm font-bold"
                style={{ border: "1px solid var(--divider)", color: "var(--text-primary)" }}
              >{t("common.cancel")}</button>
              <button
                onClick={handleSaveName}
                disabled={savingName || !nameValue.trim()}
                className="flex-1 h-12 rounded-full text-sm font-bold disabled:opacity-50"
                style={{ background: "var(--brand)", color: "#0a0a0a" }}
              >{savingName ? t("common.saving") : t("common.save")}</button>
            </div>
          </div>
        </div>
      )}

      <div className="p-4 pb-6 animate-fade-in-up delay-225">
        <button
          onClick={handleLogout}
          className="w-full h-[48px] rounded-full font-bold text-sm transition-colors border"
          style={{
            borderColor: "var(--error)",
            color: "var(--error)",
            background: "transparent",
          }}
        >
          {t("settings.signOut")}
        </button>
      </div>
    </div>
  );
}
