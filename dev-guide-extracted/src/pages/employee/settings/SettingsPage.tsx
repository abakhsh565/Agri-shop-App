import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useAuthStore } from "@/stores/authStore";
import { useThemeStore, applyTheme } from "@/stores/themeStore";
import { clearDeviceSession } from "@/lib/deviceSession";
import { useT } from "@/lib/i18n";
import { Lock, Bell, Globe, Info, ChevronRight, Moon, Sun, ClipboardList, Smartphone, Camera } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const LANG_LABELS: Record<string, string> = { en: "English", ur: "اردو" };

export default function SettingsPage() {
  const navigate = useNavigate();
  const t = useT();
  const { user, logout } = useAuthStore();
  const { theme, toggleTheme, language, setLanguage } = useThemeStore();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarUrl(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  const initials = user?.name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "?";

  return (
    <div
      className="flex flex-col w-full min-h-full justify-between"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
    >
      <div>
        <StatusBar />
        <NavHeader title="Settings" backTo="/employee/dashboard" />

        {/* Profile card */}
        <div
          className="mx-4 mt-3 rounded-xl p-4 flex items-center gap-4 animate-fade-in-up"
          style={{ border: "1px solid var(--border-light)", background: "var(--surface-2)" }}
        >
          {/* Avatar with camera overlay */}
          <div className="relative shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
            <div
              className="w-14 h-14 rounded-full overflow-hidden flex items-center justify-center text-lg font-bold cursor-pointer"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
              onClick={() => fileInputRef.current?.click()}
            >
              {avatarUrl
                ? <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                : initials
              }
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center shadow"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              <Camera size={10} strokeWidth={2.5} />
            </button>
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-base font-bold truncate" style={{ color: "var(--text-primary)" }}>
              {user?.name}
            </p>
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
                <Globe size={18} style={{ color: "var(--text-primary)" }} />
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
