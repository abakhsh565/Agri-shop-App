import BusinessSettingsSheet from '@/components/ui/BusinessSettingsSheet';
import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useAuthStore } from "@/stores/authStore";
import { useThemeStore, applyTheme } from "@/stores/themeStore";
import { clearDeviceSession } from "@/lib/deviceSession";
import { hasPin } from "@/lib/pinLock";
import { useT } from "@/lib/i18n";
import {
  Lock, Bell, Globe, Info, ChevronRight, Moon, Sun,
  ClipboardList, Smartphone, Users, Package,
  Building2, ShieldCheck, Pencil, Loader2, Save,
} from "lucide-react";
import { uploadImage } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import { projectId, publicAnonKey } from "@/../utils/supabase/info";

const LANG_LABELS: Record<string, string> = { en: "English", ur: "اردو" };

export default function AdminSettingsPage() {
  const navigate = useNavigate();
  const t = useT();
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

  function startEdit() {
    setEditName(user?.name ?? "");
    setEditImageUrl(user?.photoUrl ?? null);
    setEditing(true);
  }

  async function saveEdit() {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      // Use raw fetch to bypass expired Supabase session
      // This sends ONLY the anon key (no expired JWT)
      const response = await fetch(
        `https://${projectId}.supabase.co/rest/v1/users?id=eq.${user!.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "apikey": publicAnonKey,
            "Authorization": `Bearer ${publicAnonKey}`,
            "Prefer": "return=minimal",
          },
          body: JSON.stringify({ name: editName.trim(), photo_url: editImageUrl }),
        }
      );
      
      if (!response.ok) {
        const errBody = await response.text();
        console.error("Profile save HTTP error:", response.status, errBody);
        throw new Error(`HTTP ${response.status}: ${errBody}`);
      }
      
      useAuthStore.getState().setUser({ ...user!, name: editName.trim(), photoUrl: editImageUrl ?? undefined });
      setAvatarUrl(editImageUrl);
      setEditing(false);
    } catch (err) {
      console.error("Profile save failed:", err);
      alert("Failed to save profile. Please try again.");
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
    } catch {
      // silent
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
        <NavHeader title={t("settings.title") ?? "Profile & Settings"} />

        {/* Profile card */}
        <div
          className="mx-4 mt-3 rounded-xl p-4 flex items-center gap-4 animate-fade-in-up"
          style={{ border: "1px solid var(--border-light)", background: "var(--surface-2)" }}
        >
          <div className="relative shrink-0">
            <div
              className="w-14 h-14 rounded-full overflow-hidden flex items-center justify-center text-lg font-bold"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              {avatarUrl
                ? <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                : initials
              }
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-base font-bold truncate" style={{ color: "var(--text-primary)" }}>
                {user?.name}
              </p>
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                style={{ background: "var(--brand)", color: "#0a0a0a" }}
              >
                {t("settings.owner") || "Owner"}
              </span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
              {user?.jobTitle ?? (t("settings.storeOwner") || "Store Owner")}
            </p>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{user?.phone}</p>
          </div>

          <button
            onClick={startEdit}
            className="flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-bold shrink-0"
            style={{ background: "var(--surface)", color: "var(--text-secondary)", border: "1px solid var(--divider)" }}
          >
            <Pencil size={10} /> {t("common.edit")}
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
                    className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center shadow"
                    style={{ background: "var(--brand)", color: "#0a0a0a" }}
                  >
                    <Pencil size={10} strokeWidth={2.5} />
                  </button>
                </div>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase mb-1.5 tracking-wider" style={{ color: "var(--text-secondary)" }}>Name</p>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full h-12 rounded-[24px] px-4 text-sm outline-none"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)", borderRadius: "24px" }}
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

        {/* Appearance */}
        <div className="px-4 pt-5 animate-fade-in-up delay-75">
          <p className="text-xs font-bold uppercase mb-3 tracking-wider" style={{ color: "var(--text-secondary)" }}>
            {t("settings.appearance")}
          </p>
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-light)" }}>
            {/* Theme */}
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

            {/* Language */}
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


        </div>

        {/* Account + Management — unified section */}
        <div className="px-4 pt-5 animate-fade-in-up delay-100">
          <p className="text-xs font-bold uppercase mb-3 tracking-wider" style={{ color: "var(--text-secondary)" }}>
            {t("settings.account")}
          </p>
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-light)" }}>
            {[
              { icon: Lock,         label: user && hasPin(user.id) ? (t("settings.changePin") || "Change PIN") : (t("settings.setupPin") || "Setup PIN"),   action: () => navigate("/login/pin-set", { state: { returnTo: "/admin/settings" } }) },
              { icon: Bell,         label: t("settings.notifications"), action: () => navigate("/admin/notifications") },
              { icon: ClipboardList, label: t("settings.activityLog"), action: () => navigate("/admin/activity") },
              { icon: Smartphone,   label: t("settings.device"),       action: null,       right: t("settings.thisPhone") || "This Phone" },
              { icon: Info,         label: t("settings.appVersion"),    action: null,       right: "1.0.0" },
            ].map((s, i, arr) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.label}
                  onClick={s.action ?? undefined}
                  disabled={!s.action}
                  className={`flex items-center justify-between w-full px-4 py-4 text-start transition-colors ${i < arr.length - 1 ? "border-b" : ""} ${s.action ? "active:opacity-70" : "opacity-70"}`}
                  style={{ borderColor: "var(--border-light)" }}
                >
                  <div className="flex items-center gap-3">
                    <Icon size={18} style={{ color: "var(--brand)" }} />
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{s.label}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {"right" in s && s.right && (
                      <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{s.right as string}</span>
                    )}
                    {s.action && <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {showBusinessSettings && <BusinessSettingsSheet onClose={() => setShowBusinessSettings(false)} onSave={() => {}} />}

        {/* Business Settings */}
        <div className="px-4 pt-5 animate-fade-in-up delay-125">
          <p className="text-xs font-bold uppercase mb-3 tracking-wider" style={{ color: "var(--text-secondary)" }}>{t("common.businessSettings")}</p>
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-light)" }}>
            <button onClick={() => setShowBusinessSettings(true)} className="flex items-center justify-between w-full px-4 py-4 active:opacity-70">
              <div className="flex items-center gap-3">
                <span style={{ fontSize: 18 }}>{"🌾"}</span>
                <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{t("common.cropConfiguration")}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("common.configureReminder")}</span>
                <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />
              </div>
            </button>
          </div>
        </div>

      {/* Management shortcuts */}
        <div className="px-4 pt-5 animate-fade-in-up delay-150">
          <p className="text-xs font-bold uppercase mb-3 tracking-wider" style={{ color: "var(--text-secondary)" }}>
            {t("settings.management") || "Management"}
          </p>
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-light)" }}>
            {[
              { icon: Users,       label: t("admin.employees") ?? "Employees",  action: () => navigate("/admin/employees") },
              { icon: Building2,   label: t("admin.companies")  ?? "Companies", action: () => navigate("/admin/companies") },
              { icon: Package,     label: t("admin.inventory")  ?? "Inventory", action: () => navigate("/admin/products") },
              { icon: ShieldCheck, label: t("admin.reports")    ?? "Reports",   action: () => navigate("/admin/reports") },
            ].map((row, i, arr) => {
              const Icon = row.icon;
              return (
                <button
                  key={row.label}
                  onClick={row.action}
                  className={`flex items-center justify-between w-full px-4 py-4 text-start active:opacity-70 ${i < arr.length - 1 ? "border-b" : ""}`}
                  style={{ borderColor: "var(--border-light)" }}
                >
                  <div className="flex items-center gap-3">
                    <Icon size={18} style={{ color: "var(--brand)" }} />
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{row.label}</span>
                  </div>
                  <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="p-4 pb-6 animate-fade-in-up delay-225">
        <button
          onClick={handleLogout}
          className="w-full h-[48px] rounded-full font-bold text-sm transition-colors border"
          style={{ borderColor: "var(--error)", color: "var(--error)", background: "transparent" }}
        >
          {t("settings.signOut")}
        </button>
      </div>
    </div>
  );
}
