import { useCallback, useEffect, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ShieldAlert,
  LayoutDashboard,
  ShoppingBag,
  Package,
  Users,
  Truck,
  Building2,
  Landmark,
  BarChart3,
  CheckSquare,
  Menu,
  Settings as SettingsIcon,
  ChevronDown,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";
import { useShopStore } from "@/stores/shopStore";
import { useT } from "@/lib/i18n";
import { coOwnerEnabled } from "@/lib/experience";
import { useBootstrapData } from "@/stores/useBootstrapData";
import ToastContainer from "@/components/ui/Toast";

export interface CoOwnerAccess {
  grantId: string;
  status: string;
  businessName: string;
  tenantId: string;
  permissions: string[];
  dashboards: string[];
  authorities: Record<string, string>;
  branches: Array<{ id: string; name: string; isMain: boolean }>;
  scope: { branches_mode?: string; suppliers_mode?: string; departments_mode?: string; records_mode?: string } | null;
  canInviteEmployees: boolean;
  canDeactivateEmployees: boolean;
  canManageBranches: boolean;
}

type AccessState =
  | { kind: "loading" }
  | { kind: "ok"; access: CoOwnerAccess }
  | { kind: "ended" }
  | { kind: "error" };

export default function CoOwnerLayout() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [state, setState] = useState<AccessState>({ kind: "loading" });
  const branches = useShopStore((s) => s.branches);
  const activeBranchId = useShopStore((s) => s.activeBranchId);
  const switching = useShopStore((s) => s.switching);
  const loadBranches = useShopStore((s) => s.loadBranches);
  const switchBranch = useShopStore((s) => s.switchBranch);
  const enabled = coOwnerEnabled();
  useBootstrapData();

  const check = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_my_co_owner_access");
    if (error) {
      if (/NOT_AUTHORIZED|NOT_AUTHENTICATED/i.test(error.message)) {
        setState({ kind: "ended" });
      } else {
        setState({ kind: "error" });
      }
      return;
    }
    if (!data) {
      setState({ kind: "ended" });
      return;
    }
    setState({ kind: "ok", access: data as CoOwnerAccess });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void check();
    void loadBranches();
    const onFocus = () => void check();
    const timer = window.setInterval(() => void check(), 45_000);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, check, loadBranches]);

  useEffect(() => {
    // A new route is a protected request in its own right: revalidate the grant
    // rather than trusting the context that drew the previous screen.
    if (enabled && state.kind === "ok") void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  if (!enabled) return <Navigate to="/employee/dashboard" replace />;

  if (state.kind === "loading") {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: "var(--background)" }}>
        <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t("common.loading")}</p>
      </div>
    );
  }

  if (state.kind === "ended") {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center px-8 text-center" style={{ background: "var(--background)", color: "var(--text-primary)" }} data-testid="co-owner-access-ended">
        <span className="size-14 rounded-full flex items-center justify-center" style={{ background: "var(--tone-sunken)" }}>
          <ShieldAlert size={24} />
        </span>
        <p className="text-18 font-bold mt-4">{t("coOwner.accessEndedTitle")}</p>
        <p className="text-12 mt-2" style={{ color: "var(--text-secondary)" }}>{t("coOwner.accessEndedBody")}</p>
        <button
          type="button"
          onClick={() => void logout()}
          className="mt-6 h-11 px-6 rounded-full text-12 font-bold"
          style={{ background: "var(--cta)", color: "var(--cta-fg)" }}
        >
          {t("coOwner.signOut")}
        </button>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center px-8 text-center" style={{ background: "var(--background)", color: "var(--text-primary)" }}>
        <p className="text-15 font-bold">{t("coOwners.failed")}</p>
        <p className="text-12 mt-1" style={{ color: "var(--text-secondary)" }}>{t("coOwner.restricted")}</p>
        <button
          type="button"
          onClick={() => { setState({ kind: "loading" }); void check(); }}
          className="mt-5 h-10 px-5 rounded-full text-12 font-bold"
          style={{ background: "var(--cta)", color: "var(--cta-fg)" }}
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  const access = state.access;
  const permissions = new Set(access.permissions);
  // The grant decides the one operational tab that sits beside the hub. Everything else is in
  // More, which reads the same permission set, so a narrower grant removes doors rather than
  // leaving a row that would bounce off its guard.
  const work = [
    { key: "sales", label: t("nav.sales"), path: "/co-owner/sales", icon: ShoppingBag, show: permissions.has("sales.view") },
    { key: "products", label: t("nav.products"), path: "/co-owner/products", icon: Package, show: permissions.has("products.view") },
    { key: "customers", label: t("nav.customers"), path: "/co-owner/customers", icon: Users, show: permissions.has("customers.view") },
    { key: "purchases", label: t("nav.purchases"), path: "/co-owner/purchases", icon: Truck, show: permissions.has("purchases.view") },
    { key: "companies", label: t("more.suppliers"), path: "/co-owner/companies", icon: Building2, show: permissions.has("companies.view") },
    { key: "finance", label: t("nav.finance"), path: "/co-owner/finance", icon: Landmark, show: permissions.has("payments.view") },
    { key: "reports", label: t("admin.reports"), path: "/co-owner/reports", icon: BarChart3, show: permissions.has("reports.view") },
  ].find((item) => item.show);

  const nav = [
    { key: "dashboard", label: t("nav.dashboard"), path: "/co-owner/dashboard", icon: LayoutDashboard, show: true },
    ...(work ? [{ key: work.key, label: work.label, path: work.path, icon: work.icon, show: true }] : []),
    { key: "approvals", label: t("coOwner.approvalsTitle"), path: "/co-owner/approvals", icon: CheckSquare, show: true },
    { key: "more", label: t("nav.more"), path: "/co-owner/more", icon: Menu, show: true },
    { key: "settings", label: t("coOwner.settingsTitle"), path: "/co-owner/settings", icon: SettingsIcon, show: true },
  ].filter((item) => item.show);

  const direct = nav.find((item) => location.pathname.startsWith(item.path));
  const current = direct?.key ?? (location.pathname.startsWith("/co-owner/dashboard") ? "dashboard" : "more");

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: "var(--background)", color: "var(--text-primary)" }}>
      <header
        className="sticky top-0 z-30 px-4 pt-[max(10px,env(safe-area-inset-top))] pb-2"
        style={{ background: "var(--background)", borderBottom: "1px solid var(--divider)" }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-10 font-semibold uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>
              {access.businessName} · {t("coOwner.context")}
            </p>
            <p className="text-14 font-bold truncate">{user?.name ?? user?.phone ?? ""}</p>
          </div>
          <span
            className="text-9 font-bold px-2 py-1 rounded-full shrink-0"
            style={{ background: "color-mix(in srgb, var(--brand) 18%, transparent)", color: "var(--brand-dark)" }}
          >
            {t("coOwners.statusActive")}
          </span>
        </div>
        <div className="relative mt-2">
          <select
            value={activeBranchId ?? ""}
            disabled={switching || branches.length === 0}
            onChange={(e) => { if (e.target.value) void switchBranch(e.target.value); }}
            className="w-full h-9 rounded-full ps-3 pe-8 text-11 font-semibold appearance-none outline-none"
            style={{ background: "var(--tone-sunken)", border: "1px solid var(--border-control)", color: "var(--text-primary)" }}
            aria-label={t("coOwner.branchView")}
          >
            {branches.length === 0 && <option value="">{t("coOwner.noBranches")}</option>}
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
          </select>
          <ChevronDown size={13} className="absolute end-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-secondary)" }} />
        </div>
      </header>

      <main className="flex-1 min-h-0 pb-20">
        <Outlet context={{ access }} />
      </main>

      <nav
        className="fixed bottom-0 inset-x-0 z-40 flex items-stretch px-2 pb-[max(6px,env(safe-area-inset-bottom))] pt-1.5"
        style={{ background: "var(--surface)", borderTop: "1px solid var(--divider)" }}
        aria-label={t("nav.dashboard")}
      >
        {nav.map((item) => {
          const active = current === item.key;
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(item.path)}
              className="flex-1 flex flex-col items-center gap-0.5 py-1.5 min-w-0"
              style={{ color: active ? "var(--brand-dark)" : "var(--text-tertiary)" }}
              aria-current={active ? "page" : undefined}
              data-testid={`co-owner-nav-${item.key}`}
            >
              <Icon size={18} strokeWidth={active ? 2.4 : 1.8} />
              <span className="text-9 font-semibold truncate max-w-full">{item.label}</span>
            </button>
          );
        })}
      </nav>
      <ToastContainer />
    </div>
  );
}
