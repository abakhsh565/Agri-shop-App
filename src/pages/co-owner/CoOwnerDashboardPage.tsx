import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { ArrowRight, ChevronRight, Layers, TrendingUp, TriangleAlert } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useT } from "@/lib/i18n";
import { coOwnerErrorCode } from "@/lib/experience";
import type { CoOwnerAccess } from "@/components/layout/CoOwnerLayout";

type Range = "today" | "week" | "month" | "all";

interface Dashboard {
  business?: string;
  branches?: Array<{ id: string; name: string; sales: number; count: number }>;
  widgets?: string[];
  kpis?: { sales: number; paid: number; due: number; profit: number; count: number };
  series?: Array<{ day: string; total: number }>;
  outstanding?: number;
  inventory?: { products: number; lowStock: number };
  team?: number;
  alerts?: Array<{ kind: string; name: string; amount: number }>;
  recentSales?: Array<{ id: string; sale_number: string; customer: string; total: number; status: string; created_at: string }>;
  empty?: string;
  allBranches?: boolean;
}

function money(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(Number(value));
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[var(--radius-tile)] p-3.5 ${className}`}
      style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)" }}
    >
      {children}
    </div>
  );
}

export default function CoOwnerDashboardPage() {
  const t = useT();
  const navigate = useNavigate();
  const { access } = useOutletContext<{ access: CoOwnerAccess }>();
  const [data, setData] = useState<Dashboard | null>(null);
  const [range, setRange] = useState<Range>("month");
  const [branchFilter, setBranchFilter] = useState<string | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    (async () => {
      const { data: result, error: rpcError } = await supabase.rpc("get_co_owner_dashboard", {
        p_branch_id: branchFilter === "all" ? null : branchFilter,
        p_range: range,
      });
      if (!alive) return;
      if (rpcError) {
        setError(coOwnerErrorCode(rpcError));
        setData(null);
      } else {
        setData((result ?? {}) as Dashboard);
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [range, branchFilter]);

  const maxSeries = useMemo(() => {
    const values = data?.series?.map((p) => Number(p.total)) ?? [];
    return Math.max(1, ...values);
  }, [data]);

  const ranges: Array<{ key: Range; label: string }> = [
    { key: "today", label: t("coOwner.today") },
    { key: "week", label: t("coOwner.week") },
    { key: "month", label: t("coOwner.month") },
    { key: "all", label: t("coOwner.all") },
  ];

  return (
    <div className="px-4 pt-3 pb-4" data-testid="co-owner-dashboard">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-18 font-bold">{t("nav.dashboard")}</h1>
          <p className="text-10 mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {access.businessName} · {t("coOwner.context")}
          </p>
        </div>
        <span className="size-9 rounded-full flex items-center justify-center" style={{ background: "var(--tone-sunken)" }}>
          <TrendingUp size={16} style={{ color: "var(--brand-dark)" }} />
        </span>
      </div>

      <div className="flex gap-1.5 mt-3 overflow-x-auto">
        {ranges.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className="h-8 px-3 rounded-full text-10 font-semibold shrink-0"
            style={{
              background: range === r.key ? "var(--brand)" : "var(--tone-sunken)",
              color: range === r.key ? "#0a0a0a" : "var(--text-secondary)",
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5 mt-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setBranchFilter("all")}
          className="h-8 px-3 rounded-full text-10 font-semibold shrink-0 flex items-center gap-1"
          style={{
            background: branchFilter === "all" ? "var(--text-primary)" : "var(--tone-sunken)",
            color: branchFilter === "all" ? "var(--background)" : "var(--text-secondary)",
          }}
          data-testid="co-owner-all-branches"
        >
          <Layers size={11} />
          {t("coOwner.allBranches")}
        </button>
        {access.branches.map((branch) => (
          <button
            key={branch.id}
            type="button"
            onClick={() => setBranchFilter(branch.id)}
            className="h-8 px-3 rounded-full text-10 font-semibold shrink-0"
            style={{
              background: branchFilter === branch.id ? "var(--text-primary)" : "var(--tone-sunken)",
              color: branchFilter === branch.id ? "var(--background)" : "var(--text-secondary)",
            }}
          >
            {branch.name}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-12 py-12 text-center" style={{ color: "var(--text-secondary)" }}>{t("common.loading")}</p>
      ) : error ? (
        <Card className="mt-4">
          <p className="text-13 font-bold">{t("coOwners.failed")}</p>
          <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>{error}</p>
        </Card>
      ) : data?.empty === "no_branches" || access.branches.length === 0 ? (
        <Card className="mt-4">
          <p className="text-13 font-bold">{t("coOwner.noBranches")}</p>
          <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>{t("coOwners.scopeHint")}</p>
        </Card>
      ) : (
        <>
          {data?.kpis && (
            <div className="grid grid-cols-2 gap-2 mt-4">
              <Card>
                <p className="text-10" style={{ color: "var(--text-secondary)" }}>{t("coOwner.sales")}</p>
                <p className="text-20 font-bold mt-1 tabular-nums">{money(data.kpis.sales)}</p>
                <p className="text-9 mt-0.5" style={{ color: "var(--text-tertiary)" }}>{t("coOwner.count")}: {data.kpis.count}</p>
              </Card>
              <Card>
                <p className="text-10" style={{ color: "var(--text-secondary)" }}>{t("coOwner.paid")}</p>
                <p className="text-20 font-bold mt-1 tabular-nums">{money(data.kpis.paid)}</p>
              </Card>
              <Card>
                <p className="text-10" style={{ color: "var(--text-secondary)" }}>{t("coOwner.due")}</p>
                <p className="text-20 font-bold mt-1 tabular-nums">{money(data.kpis.due)}</p>
              </Card>
              <Card>
                <p className="text-10" style={{ color: "var(--text-secondary)" }}>{t("coOwner.profit")}</p>
                <p className="text-20 font-bold mt-1 tabular-nums">{money(data.kpis.profit)}</p>
              </Card>
            </div>
          )}

          {data?.series && data.series.length > 0 && (
            <Card className="mt-2.5">
              <p className="text-11 font-bold">{t("coOwner.sales")}</p>
              <div className="flex items-end gap-1.5 h-24 mt-3">
                {data.series.map((point) => {
                  const height = Math.max(3, (Number(point.total) / maxSeries) * 84);
                  return (
                    <div key={point.day} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                      <div
                        className="w-full max-w-7 rounded-t-[4px]"
                        style={{ height, background: "var(--brand)" }}
                        title={`${money(point.total)} · ${point.day}`}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-1 text-8" style={{ color: "var(--text-tertiary)" }}>
                <span>{new Date(data.series[0].day).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                <span>{new Date(data.series[data.series.length - 1].day).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              </div>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-2 mt-2.5">
            {data?.outstanding !== undefined && (
              <Card>
                <p className="text-10" style={{ color: "var(--text-secondary)" }}>{t("coOwner.outstanding")}</p>
                <p className="text-17 font-bold mt-1 tabular-nums">{money(data.outstanding)}</p>
              </Card>
            )}
            {data?.inventory && (
              <Card>
                <p className="text-10" style={{ color: "var(--text-secondary)" }}>{t("coOwner.products")}</p>
                <p className="text-17 font-bold mt-1 tabular-nums">{data.inventory.products}</p>
                <p className="text-9" style={{ color: "var(--text-tertiary)" }}>{t("coOwner.lowStock")}: {data.inventory.lowStock}</p>
              </Card>
            )}
            {data?.team !== undefined && (
              <Card>
                <p className="text-10" style={{ color: "var(--text-secondary)" }}>{t("coOwner.team")}</p>
                <p className="text-17 font-bold mt-1 tabular-nums">{data.team}</p>
              </Card>
            )}
          </div>

          {data?.branches && data.branches.length > 0 && (
            <Card className="mt-2.5">
              <p className="text-11 font-bold">{t("coOwners.branches")}</p>
              <div className="mt-2 flex flex-col">
                {data.branches.map((branch) => (
                  <div key={branch.id} className="flex items-center justify-between py-1.5" style={{ borderTop: "1px solid var(--divider)" }}>
                    <span className="text-11 truncate">{branch.name}</span>
                    <span className="text-11 font-semibold tabular-nums">{money(branch.sales)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {data?.recentSales && data.recentSales.length > 0 && (
            <Card className="mt-2.5">
              <div className="flex items-center justify-between">
                <p className="text-11 font-bold">{t("coOwner.recentSales")}</p>
                <button type="button" onClick={() => navigate("/co-owner/sales")} className="text-10 font-semibold" style={{ color: "var(--brand-dark)" }}>
                  {t("common.viewAll")}
                </button>
              </div>
              <div className="mt-1">
                {data.recentSales.map((sale) => (
                  <button
                    key={sale.id}
                    type="button"
                    onClick={() => navigate(`/co-owner/sales/${sale.id}`)}
                    className="w-full flex items-center justify-between gap-2 py-2 text-start"
                    style={{ borderTop: "1px solid var(--divider)" }}
                  >
                    <span className="min-w-0">
                      <span className="block text-11 font-semibold truncate">{sale.customer || sale.sale_number}</span>
                      <span className="block text-9" style={{ color: "var(--text-tertiary)" }}>{sale.sale_number}</span>
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      <span className="text-11 font-bold tabular-nums">{money(sale.total)}</span>
                      <ChevronRight size={12} style={{ color: "var(--text-tertiary)" }} />
                    </span>
                  </button>
                ))}
              </div>
            </Card>
          )}

          {data?.alerts && data.alerts.length > 0 && (
            <Card className="mt-2.5">
              <p className="text-11 font-bold flex items-center gap-1">
                <TriangleAlert size={12} />
                {t("coOwner.alerts")}
              </p>
              {data.alerts.map((alert, index) => (
                <div key={`${alert.name}-${index}`} className="flex items-center justify-between py-1.5" style={{ borderTop: "1px solid var(--divider)" }}>
                  <span className="text-11 truncate">{alert.name}</span>
                  <span className="text-11 font-semibold tabular-nums">{money(alert.amount)}</span>
                </div>
              ))}
            </Card>
          )}

          <div className="mt-2.5">
            <p className="text-11 font-bold mb-1.5">{t("coOwner.quickActions")}</p>
            <div className="flex gap-2">
              {access.permissions.includes("sales.create") && (
                <button
                  type="button"
                  onClick={() => navigate("/co-owner/sales")}
                  className="flex-1 h-10 rounded-full text-11 font-bold flex items-center justify-center gap-1"
                  style={{ background: "var(--cta)", color: "var(--cta-fg)" }}
                >
                  {t("nav.sales")}
                  <ArrowRight size={12} />
                </button>
              )}
              {access.permissions.includes("reports.view") && (
                <button
                  type="button"
                  onClick={() => navigate("/co-owner/reports")}
                  className="flex-1 h-10 rounded-full text-11 font-bold"
                  style={{ background: "var(--tone-sunken)", color: "var(--text-primary)" }}
                >
                  {t("coOwner.viewReports")}
                </button>
              )}
            </div>
          </div>

          {(!data?.kpis && !data?.series && data?.outstanding === undefined && !data?.inventory) && (
            <Card className="mt-4">
              <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t("coOwner.noData")}</p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
