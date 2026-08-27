import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useAuthStore } from "@/stores/authStore";
import { useThemeStore, applyTheme } from "@/stores/themeStore";
import { clearDeviceSession } from "@/lib/deviceSession";
import { useT } from "@/lib/i18n";
import { uploadImage } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import { useUIStore } from "@/stores/uiStore";
import { Lock, Bell, Globe, Info, ChevronRight, Moon, Sun, ClipboardList, Smartphone, Camera, Loader2, User, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
      className="flex flex-col w-full min-h-full justify-between"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
    >
      <div>
        <StatusBar />
        <NavHeader title="Settings" />

        {/* Profile card */}
        <div
          className="mx-4 mt-3 rounded-xl p-4 flex items-center gap-4 animate-fade-in-up"
          style={{ border: "1px solid var(--border-light)", background: "var(--surface-2)" }}
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
              className="w-14 h-14 rounded-full overflow-hidden flex items-center justify-center text-lg font-bold"
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
                className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center"
                style={{ background: "var(--surface)", color: "var(--text-secondary)" }}
              >
                <User size={12} />
              </button>
            </div>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
              {user?.jobTitle ?? "Store Associate"}
              {user?.employeeNumber ? ` · Emp #${user.employeeNumber}` : ""}
            </p>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{user?.phone}</p>
          </div>
        </div>

        {/* Appearance */}
        <div className="px-4 pt-5 animate-fade-in-up delay-75">
          <p className="text-xs font-bold uppercase mb-3 tracking-wider" style={{ color: "var(--text-secondary)" }}>
            {t("settings.appearance")}
          </p>
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: "1px solid var(--border-light)" }}
          >
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="flex items-center justify-between w-full px-4 py-4 border-b"
              style={{ borderColor: "var(--border-light)" }}
            >
              <div className="flex items-center gap-3">
                {theme === "dark"
                  ? <Moon size={18} style={{ color: "var(--brand)" }} />
                  : <Sun size={18} style={{ color: "var(--brand)" }} />
                }
                <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  {theme === "dark" ? t("settings.darkMode") : t("settings.lightMode")}
                </span>
              </div>
              {/* Toggle pill */}
              <div
                className="relative w-12 h-6 rounded-full transition-all duration-300"
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
            </button>

            {/* Language toggle */}
            <button
              onClick={cycleLanguage}
              className="flex items-center justify-between w-full px-4 py-4"
            >
              <div className="flex items-center gap-3">
                <Globe size={18} style={{ color: "var(--brand)" }} />
                <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{t("settings.language")}</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="text-xs font-bold px-3 py-1 rounded-full"
                  style={{ background: "var(--brand)", color: "#0a0a0a" }}
                >
                  {LANG_LABELS[language]}
                </span>
                <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />
              </div>
            </button>
          </div>

          {/* Urdu notice */}
          {language === "ur" && (
            <div
              className="mt-2 px-4 py-3 rounded-xl text-right text-sm animate-fade-in-up"
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
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: "1px solid var(--border-light)" }}
          >
            {[
              {
                icon: Lock, label: t("settings.changePin"),
                right: null, action: () => navigate("/login/pin-set"),
              },
              {
                icon: Bell, label: t("settings.notifications"),
                right: "On", action: null,
              },
              {
                icon: ClipboardList, label: t("settings.activityLog"),
                right: null, action: () => navigate("/employee/activity"),
              },
              {
                icon: Smartphone, label: t("settings.device"),
                right: "This Phone", action: null,
              },
              {
                icon: Info, label: t("settings.appVersion"),
                right: "1.0.0", action: null,
              },
            ].map((s, i, arr) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.label}
                  onClick={s.action ?? undefined}
                  disabled={!s.action}
                  className={`flex items-center justify-between w-full px-4 py-4 text-left transition-colors ${
                    i < arr.length - 1 ? "border-b" : ""
                  } ${s.action ? "active:opacity-70" : "opacity-70"}`}
                  style={{ borderColor: "var(--border-light)" }}
                >
                  <div className="flex items-center gap-3">
                    <Icon size={18} style={{ color: "var(--text-primary)" }} />
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{s.label}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {s.right && (
                      <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{s.right}</span>
                    )}
                    {s.action && <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="p-4 pb-6 animate-fade-in-up delay-225">
      {/* Edit Profile Popup */}
      {editingName && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => { setEditingName(false); setNameValue(user?.name ?? ""); }}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-md rounded-t-2xl p-5 pb-8 animate-slide-up"
            style={{ background: "var(--surface)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-[15px] font-bold" style={{ color: "var(--text-primary)" }}>Edit Profile</p>
              <button onClick={() => { setEditingName(false); setNameValue(user?.name ?? ""); }} className="text-xl" style={{ color: "var(--text-secondary)" }}>×</button>
            </div>
            {/* Photo in popup */}
            <div className="flex flex-col items-center mb-4">
              <div className="relative">
                <div className="w-20 h-20 rounded-full overflow-hidden flex items-center justify-center text-2xl font-bold" style={{ background: "var(--brand)", color: "#0a0a0a" }}>
                  {avatarUrl ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" /> : initials}
                </div>
                <button
                  onClick={() => { setEditingName(false); fileInputRef.current?.click(); }}
                  className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center shadow"
                  style={{ background: "var(--brand)", color: "#0a0a0a" }}
                >
                  <Camera size={13} strokeWidth={2.5} />
                </button>
              </div>
            </div>
            {/* Name input */}
            <div className="mb-4">
              <label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: "var(--text-secondary)" }}>Name</label>
              <input
                autoFocus
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveName(); }}
                className="w-full h-11 px-4 rounded-xl text-sm font-bold outline-none"
                style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
              />
            </div>
            <button
              onClick={handleSaveName}
              disabled={savingName || !nameValue.trim()}
              className="w-full h-11 rounded-xl text-[13px] font-bold disabled:opacity-50"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              {savingName ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      )}

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
