import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useDir } from "@/lib/dirContext";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { Settings, Users, Bell, ChevronRight, Compass } from "lucide-react";

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
  const { isRtl } = useDir();

  const bg = initBgColor(user?.name ?? "U");
  const initials = user?.name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "U";

  const MENU_ITEMS = [
    { key: "nav.customers", icon: Users, path: "/employee/customers" },
    { key: "common.notifications", icon: Bell, path: "/employee/notifications" },
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
        <div className="rounded-[var(--radius-card)] p-4 flex items-center gap-3" style={{ background: "var(--tone-card)" }}>
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold shrink-0"
            style={{ background: bg, color: "#fff" }}
          >
            {initials}
          </div>
          {/* Two lines, as on Settings: who the account is, then the number under it — and
              the role as a quiet chip beside the name rather than a second line that
              repeats the chip it already shows. */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <p className="text-base font-bold truncate" style={{ color: "var(--text-primary)" }}>{user?.name}</p>
              {user?.role && (
                <span
                  className="text-11 font-bold px-2 py-0.5 rounded-full shrink-0 capitalize"
                  style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                >
                  {user.role.replace("_", " ")}
                </span>
              )}
            </div>
            <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>{user?.phone}</p>
          </div>
        </div>
      </div>

      {/* App guide — the employee's way back into the tour and the education sections,
          which are written for what an employee can actually do rather than for an
          owner's controls. Its own card, above the menu: it is about the app itself. */}
      <div className="px-4 pb-3">
        <ListCard>
          <ListRow
            anchor="more:guide"
            onClick={() => navigate("/employee/guide")}
            icon={Compass}
            title={t("edu.guide.title")}
            meta={t("edu.guide.rowSub")}
            trailing={
              <ChevronRight
                size={14}
                className="ds-row-chevron shrink-0"
                style={{
                  color: "var(--text-secondary)",
                  transform: isRtl ? "rotate(180deg)" : undefined,
                }}
              />
            }
          />
        </ListCard>
      </div>

      {/* Menu — one grouped card with hairlines, on the shared row primitive, exactly as
          Settings renders its rows: same glyph size, same label size, same row height. Each
          item used to be its own card with a 16pt glyph in a grey circle, which is why this
          page read as a different app from the screen it opens into. */}
      <div className="px-4">
        <ListCard>
          {MENU_ITEMS.map(({ key, icon, path }) => (
            <ListRow
              key={path}
              onClick={() => navigate(path)}
              icon={icon}
              title={t(key as any)}
              trailing={
                <ChevronRight
                  size={14}
                  className="ds-row-chevron shrink-0"
                  style={{
                    color: "var(--text-secondary)",
                    transform: isRtl ? "rotate(180deg)" : undefined,
                  }}
                />
              }
            />
          ))}
        </ListCard>
      </div>
    </div>
  );
}
