import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { Settings, Users, Bell, ChevronRight } from "lucide-react";

function initBgColor(name: string | null | undefined) {
  const colors = ["#84cc16","#3b82f6","#8b5cf6","#f59e0b","#06b6d4","#ec4899"];
  let hash = 0;
  if (!name) return colors[0];
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

export default function MorePage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";

  const bg = initBgColor(user?.name ?? "U");
  const initials = user?.name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "U";

  const MENU_ITEMS = [
    { key: "nav.customers", icon: Users, path: "/employee/customers" },
    { key: "Notifications", icon: Bell, path: "/employee/notifications" },
    { key: "settings.title", icon: Settings, path: "/employee/settings" },
  ];

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}>
      <StatusBar />

      {/* Header */}
      <div className="flex items-center px-4 pt-1 pb-2">
        <p className="text-20 font-bold" style={{ color: "var(--text-primary)" }}>
          {t("admin.more")}
        </p>
      </div>

      {/* Profile card */}
      <div className="px-4 pb-4">
        <div className="rounded-[var(--radius-card)] p-4 flex items-center gap-3" style={{ background: "var(--surface-2)" }}>
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold shrink-0"
            style={{ background: bg, color: "#fff" }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-15 font-bold truncate" style={{ color: "var(--text-primary)" }}>{user?.name}</p>
            <p className="text-12 capitalize" style={{ color: "var(--text-secondary)" }}>{user?.role?.replace("_", " ")}</p>
          </div>
        </div>
      </div>

      {/* Menu items */}
      <div className="flex flex-col px-4 gap-2">
        {MENU_ITEMS.map(({ key, icon: Icon, path }) => (
          <button
            key={path}
            onClick={() => navigate(path)}
            className="flex items-center gap-3 p-3 rounded-[var(--radius-card)] transition-all active:scale-[0.98]"
            style={{ background: "var(--surface-2)" }}
          >
            <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--divider)" }}>
              <Icon size={16} style={{ color: "var(--text-primary)" }} />
            </div>
            <p className="flex-1 text-start text-14 font-semibold" style={{ color: "var(--text-primary)" }}>
              {key.startsWith("nav.") || key.startsWith("settings.") ? t(key as any) : key}
            </p>
            <ChevronRight size={16} style={{ color: "var(--text-secondary)" }} />
          </button>
        ))}
      </div>
    </div>
  );
}
