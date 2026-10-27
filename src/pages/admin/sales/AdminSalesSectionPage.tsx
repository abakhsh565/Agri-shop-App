import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Ban, ChevronRight, Plus, ShoppingCart, Undo2, type LucideIcon } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListRow from "@/components/ui/ListRow";
import SearchBar from "@/components/ui/SearchBar";
import SalesActivitySheet, { type SalesActivityKind } from "@/components/sales/SalesActivitySheet";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { formatCurrency } from "@/lib/formatters";
import { pkDateFromISO, pkToday } from "@/lib/pkDate";
import { useSalesStore } from "@/stores/salesStore";
import { netSalesOf, refundsBySale, useReturns } from "@/lib/salesActivity";
import { hubSection } from "@/lib/settingsHub";

/**
 * Sales, as one screen: what happened today, one way to start the next sale, and the three
 * ledgers behind it.
 *
 * WHY THIS SCREEN EXISTS. The Sales section used to be four rows that mostly pointed at the same
 * list — "Returns" and "Voided sales" both opened All Sales and then asked the reader to find the
 * thing the row had just named. A row that opens the right ledger, or nothing at all, is the rule
 * in `lib/settingsHub`; this screen keeps the rule and gives the two ledgers their own doors.
 *
 * SHAPE (owner's reference, 2026-10-28): the section's own header card, New Sale as the one
 * quick action, today's two figures, the search field, then the activity rows. The two figures
 * are the app's real ones — today's sales by the app's own day boundary, and net sales, which is
 * sales less the refunds of those same sales (`lib/salesActivity` derives both, so the All Sales
 * screen cannot disagree with this one).
 *
 * Deliberately unboxed below the header, like every other section hub: each row is a different
 * place, so a card around them would draw a second edge without grouping anything.
 */
export default function AdminSalesSectionPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const sales = useSalesStore((s) => s.sales);
  const ready = useSalesStore((s) => s.ready);
  const { returns } = useReturns();
  const [query, setQuery] = useState("");
  const [openSheet, setOpenSheet] = useState<SalesActivityKind | null>(null);

  // The section's own catalogue (`lib/settingsHub`), the same file the Settings menu reads: the
  // labels here and the New sale destination come from it, so this screen cannot list a job the
  // app does not have, and the menu cannot name one this screen does not offer.
  const catalogue = hubSection("sales")?.rows ?? [];
  const rowLabel = (id: string, fallbackKey: string) => {
    const row = catalogue.find((r) => r.id === id);
    return t(row?.labelKey ?? fallbackKey);
  };
  const newSaleTo = catalogue.find((r) => r.id === "new")?.to ?? "/sale";

  const todayStr = pkToday();
  const today = sales.filter((s) => !s.isVoided && pkDateFromISO(s.createdAt) === todayStr);
  // Today's takings, less the refunds of today's own sales — never a period's refund total
  // subtracted from a different period's sales.
  const netToday = netSalesOf(today, refundsBySale(returns));

  /** The search field hands its words to All Sales, which owns searching. */
  function search() {
    const term = query.trim();
    navigate(term ? `${base}/sales?q=${encodeURIComponent(term)}` : `${base}/sales`);
  }

  const activity: { id: string; icon: LucideIcon; title: string; hint: string; run: () => void }[] = [
    {
      id: "all",
      icon: ShoppingCart,
      title: rowLabel("all", "hub.sales.all"),
      hint: t("hub.sales.allHint"),
      run: () => navigate(`${base}/sales`),
    },
    {
      id: "returns",
      icon: Undo2,
      title: rowLabel("returns", "hub.sales.returns"),
      hint: t("hub.sales.returnsHint"),
      run: () => setOpenSheet("returns"),
    },
    {
      id: "voided",
      icon: Ban,
      title: rowLabel("voided", "hub.sales.voided"),
      hint: t("hub.sales.voidedHint"),
      run: () => setOpenSheet("voided"),
    },
  ];

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="sales-hub-page"
    >
      <StatusBar />
      <NavHeader title={t("settings.menu.sales")} backTo={`${base}/settings`} />

      <div className="px-4 pt-1">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--surface)", border: "1px solid var(--border-light)" }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-16 font-bold" style={{ color: "var(--text-primary)" }}>
                {t("settings.menu.sales")}
              </p>
              <p className="text-12 mt-1" style={{ color: "var(--text-secondary)" }}>
                {t("hub.sales.subtitle")}
              </p>
            </div>
            <div className="flex flex-col items-center gap-1 shrink-0">
              <ShoppingCart size={20} style={{ color: "var(--brand-dark)" }} />
              <span className="text-10" style={{ color: "var(--text-secondary)" }}>
                {t("settings.menu.sales")}
              </span>
            </div>
          </div>

          {/* The one quick action: starting a sale is the job this section is opened for. */}
          <button
            type="button"
            onClick={() => navigate(`${base}${newSaleTo}`)}
            data-testid="hub-row-new"
            className="mt-3 w-full flex items-center gap-3 rounded-[var(--radius-tile)] p-3 text-start active:opacity-70"
            style={{ background: "var(--surface-2)" }}
          >
            <span
              className="size-10 rounded-[var(--radius-tile)] flex items-center justify-center shrink-0"
              style={{ background: "var(--brand)" }}
            >
              <Plus size={20} style={{ color: "#0a0a0a" }} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-14 font-bold" style={{ color: "var(--text-primary)" }}>
                {rowLabel("new", "hub.sales.new")}
              </span>
              <span className="block text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                {t("hub.sales.newHint")}
              </span>
            </span>
            <ChevronRight size={16} style={{ color: "var(--text-secondary)" }} className="shrink-0" />
          </button>

          <div className="flex gap-2 mt-3">
            <div
              className="flex-1 rounded-[var(--radius-tile)] p-3 flex flex-col gap-1"
              style={{ background: "var(--surface-2)" }}
            >
              <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
                {t("hub.sales.todayCount")}
              </p>
              <p className="text-16 font-bold" style={{ color: "var(--text-primary)" }} data-testid="sales-hub-today-count">
                {ready ? today.length : "—"}
              </p>
            </div>
            <div
              className="flex-1 rounded-[var(--radius-tile)] p-3 flex flex-col gap-1"
              style={{ background: "var(--surface-2)" }}
            >
              <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
                {t("hub.sales.todayNet")}
              </p>
              <p className="text-16 font-bold" style={{ color: "var(--brand-dark)" }} data-testid="sales-hub-today-net">
                {ready ? formatCurrency(netToday) : "—"}
              </p>
              <p className="text-10" style={{ color: "var(--text-secondary)" }}>
                {t("sales.netSalesHint")}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Search hands off to All Sales, which owns searching a ledger. */}
      <div className="px-4 pt-3">
        <SearchBar
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          onKeyDown={(e) => {
            if (e.key === "Enter") search();
          }}
          placeholder={t("sales.searchPlaceholder")}
        />
      </div>

      <p className="text-15 font-bold px-4 mt-5 mb-1">{t("hub.sales.activity")}</p>

      <div className="pb-6">
        {activity.map((row) => (
          <ListRow
            key={row.id}
            testId={`hub-row-${row.id}`}
            icon={row.icon}
            title={row.title}
            description={row.hint}
            trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
            onClick={row.run}
          />
        ))}
      </div>

      <SalesActivitySheet
        kind={openSheet ?? "returns"}
        open={openSheet !== null}
        onClose={() => setOpenSheet(null)}
      />
    </div>
  );
}
