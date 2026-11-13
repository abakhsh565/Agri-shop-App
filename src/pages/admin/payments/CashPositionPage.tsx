import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Plus,
  ReceiptText,
  RefreshCw,
  Share2,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import Sheet from "@/components/ui/Sheet";
import SectionActionsSheet, {
  SectionActionsButton,
  type SectionAction,
} from "@/components/ui/SectionActionsSheet";
import DateField, { displayDate } from "@/components/ui/DateField";
import { Skeleton, SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { useSalesStore } from "@/stores/salesStore";
import { useShopStore } from "@/stores/shopStore";
import { loadPaymentLedger, type LedgerPayment } from "@/lib/paymentLedger";
import { formatCurrency, formatSmartDateTime } from "@/lib/formatters";
import { pkDateFromISO, pkToday } from "@/lib/pkDate";
import { downloadCsv } from "@/lib/csv";
import { exportText } from "@/lib/exportData";
import { supabase } from "@/lib/supabase";

/**
 * Daily cash — one day at the till.
 *
 * WHAT THE OWNER ASKED FOR (2026-11-05): how much cash should be in the till on a day, how much
 * was actually recorded, and a calendar above the data that changes both. The old screen answered
 * a monthly question ("cash taken this month") and had no way to write down a count.
 *
 * THE TWO FIGURES:
 *   - Expected cash is the cash the day should have produced: cash sales at the counter, plus the
 *     customer payments received in cash, minus the supplier payments made in cash.
 *   - Recorded cash is the count saved for that same day, read back from `cash_reconciliations`.
 *     Saving goes through `record_cash_reconciliation_v1`, the existing owner-only RPC, so the
 *     count survives a reload and is the same one the close-of-day check sees.
 *
 * EVERYTHING BELOW THE SEARCH IS THE SAME DAY. The movements list, the two direction filters and
 * the export all read the date in the card, so the calendar never changes a title while leaving
 * yesterday's rows underneath it.
 *
 * The list is cash only. A bank transfer did not pass through the till, so it cannot explain the
 * counted notes; keeping it out of this list means the rows and the expected figure describe the
 * same money. The full ledger lives in Finance → Money.
 */
type Direction = "all" | "in" | "out";

interface SavedCount {
  counted: number;
  expected: number;
  variance: number;
}

export default function CashPositionPage() {
  const t = useT();
  const base = useShellBase();
  const { addToast } = useUIStore();
  const role = useAuthStore((s) => s.user?.membershipRole);
  const isOwner = role === "owner";
  const activeShopId = useShopStore((s) => s.activeShopId);

  const sales = useSalesStore((s) => s.sales);
  const salesReady = useSalesStore((s) => s.ready);
  const loadSales = useSalesStore((s) => s.load);

  const [entries, setEntries] = useState<LedgerPayment[] | null>(null);
  const [ledgerFailed, setLedgerFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<Direction>("all");
  const [menuOpen, setMenuOpen] = useState(false);

  const today = pkToday();
  const [date, setDate] = useState(today);

  const [count, setCount] = useState<SavedCount | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [countReloadKey, setCountReloadKey] = useState(0);
  const [cashOpen, setCashOpen] = useState(false);
  const [cashAmount, setCashAmount] = useState("");
  const [savingCash, setSavingCash] = useState(false);

  useEffect(() => {
    if (!salesReady) void loadSales();
  }, [salesReady, loadSales]);

  useEffect(() => {
    let live = true;
    setLedgerFailed(false);
    loadPaymentLedger()
      .then((ledger) => {
        if (live) setEntries(ledger.entries);
      })
      .catch(() => {
        if (live) setLedgerFailed(true);
      })
      .finally(() => {
        if (live) setRefreshing(false);
      });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  // The saved count for the chosen day. A missing row is the honest "not counted yet", not zero.
  useEffect(() => {
    let live = true;
    if (!activeShopId) {
      setCount(null);
      setCountLoading(false);
      return;
    }
    setCount(null);
    setCountLoading(true);
    void (async () => {
      const { data, error } = await supabase
        .from("cash_reconciliations")
        .select("counted_cash, expected_cash, variance")
        .eq("shop_id", activeShopId)
        .eq("reconciliation_date", date)
        .maybeSingle();
      if (!live) return;
      if (!error && data) {
        setCount({
          counted: Number(data.counted_cash),
          expected: Number(data.expected_cash),
          variance: Number(data.variance),
        });
      } else {
        setCount(null);
      }
      setCountLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [activeShopId, date, countReloadKey]);

  const cashSales = useMemo(
    () =>
      sales
        .filter(
          (sale) =>
            !sale.isVoided &&
            sale.paymentMethod === "cash" &&
            pkDateFromISO(sale.createdAt) === date,
        )
        .reduce(
          (sum, sale) =>
            sum + (sale.paymentType === "full" ? sale.totalAmount : Math.max(0, sale.amountPaid)),
          0,
        ),
    [sales, date],
  );

  const dayEntries = useMemo(
    () => (entries ?? []).filter((entry) => pkDateFromISO(entry.createdAt) === date),
    [entries, date],
  );
  const cashEntries = useMemo(
    () => dayEntries.filter((entry) => entry.method === "cash"),
    [dayEntries],
  );
  const flows = useMemo(
    () =>
      cashEntries.reduce(
        (totals, entry) => {
          if (entry.direction === "in") totals.received += Math.max(0, entry.amount);
          else totals.paid += Math.max(0, entry.amount);
          return totals;
        },
        { received: 0, paid: 0 },
      ),
    [cashEntries],
  );

  const expected = cashSales + flows.received - flows.paid;
  const ready = salesReady && entries !== null;
  const variance = count ? count.counted - expected : null;

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return cashEntries.filter((entry) => {
      if (direction === "in" && entry.direction !== "in") return false;
      if (direction === "out" && entry.direction !== "out") return false;
      if (term && !entry.counterparty.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [cashEntries, direction, search]);

  const methodLabel = (method: string) =>
    method === "cash" ? t("sale.cash") : method === "bank_transfer" ? t("sale.bankTransfer") : method;

  const filters: { key: Direction; label: string }[] = [
    { key: "all", label: t("cashPosition.filterAll") },
    { key: "in", label: t("cashPosition.received") },
    { key: "out", label: t("cashPosition.paid") },
  ];

  const refresh = useCallback(() => {
    setRefreshing(true);
    setReloadKey((value) => value + 1);
    setCountReloadKey((value) => value + 1);
    if (!salesReady) void loadSales();
  }, [salesReady, loadSales]);

  function openCount() {
    setCashAmount(count ? String(count.counted) : "");
    setCashOpen(true);
  }

  async function saveCount() {
    if (!isOwner || savingCash) return;
    const amount = Number(cashAmount);
    if (cashAmount.trim() === "" || !Number.isFinite(amount) || amount < 0) {
      addToast(t("copy.enterCountedCash"), "warning");
      return;
    }
    setSavingCash(true);
    try {
      // The ledger's current name (`0025` dropped the `_v1` form; `0308` restores the write under
      // this signature). Calling the retired name is a call `authenticated` cannot execute.
      const { error } = await supabase.rpc("record_cash_reconciliation", {
        payload: { date, expectedCash: expected, countedCash: amount, notes: null },
      });
      if (error) throw error;
      setCount({ counted: amount, expected, variance: amount - expected });
      setCashOpen(false);
      addToast(t("cashPosition.saved"), "success");
    } catch {
      addToast(t("cashPosition.saveFailed"), "error");
    } finally {
      setSavingCash(false);
    }
  }

  function exportRows() {
    if (!rows.length) {
      addToast(t("cashPosition.exportEmpty"), "info");
      return;
    }
    const header = [
      t("finance.ledger.date"),
      t("cashPosition.exportDirection"),
      t("cashPosition.exportParty"),
      t("cashPosition.exportType"),
      t("finance.amount"),
    ];
    const body = rows.map((entry) => {
      const incoming = entry.direction === "in";
      return [
        formatSmartDateTime(entry.createdAt, undefined, t),
        incoming ? t("cashPosition.received") : t("cashPosition.paid"),
        entry.counterparty,
        incoming ? t("payments.customerPayment") : t("payments.supplierPayment"),
        (incoming ? 1 : -1) * entry.amount,
      ];
    });
    downloadCsv(`cash-position_${date}.csv`, [header, ...body]);
    addToast(t("cashPosition.exported"), "success");
  }

  async function shareSummary() {
    const text = t("cashPosition.shareText", {
      month: displayDate(date),
      cash: ready ? formatCurrency(expected) : "—",
      received: entries ? formatCurrency(flows.received) : "—",
      paid: entries ? formatCurrency(flows.paid) : "—",
    });
    // The app's one share path: the platform's own sheet (Android app or phone browser), and the
    // clipboard where no sheet exists. This screen used to hand-roll the same three branches.
    try {
      await exportText(text, t("cashPosition.title"));
      addToast(t("cashPosition.shared"), "success");
    } catch {
      addToast(t("cashPosition.shareFailed"), "error");
    }
  }

  const actions: SectionAction[] = [
    { id: "share", icon: Share2, title: t("cashPosition.share"), onClick: shareSummary },
    { id: "export", icon: Download, title: t("cashPosition.download"), onClick: exportRows },
    { id: "refresh", icon: RefreshCw, title: t("cashPosition.refresh"), onClick: refresh },
  ];

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="cash-position-page"
    >
      <StatusBar />
      <NavHeader
        title={t("cashPosition.title")}
        backTo={`${base}/settings/hub/finance`}
        historyBack
        right={
          <SectionActionsButton
            onClick={() => setMenuOpen(true)}
            label={t("cashPosition.menu")}
            testId="cash-position-menu"
          />
        }
      />

      <div className="px-4 pt-2">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--tone-card)" }}
          data-testid="cash-position-summary"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-10" style={{ color: "var(--text-secondary)" }}>
                {t("cashPosition.expected")}
              </p>
              {ready ? (
                <p
                  className="text-22 font-bold tabular-nums break-words"
                  style={{ color: "var(--brand-dark)" }}
                  data-testid="cash-position-expected"
                >
                  {formatCurrency(expected)}
                </p>
              ) : (
                <Skeleton w="140px" h="26px" />
              )}
            </div>

            <DateField
              value={date}
              onChange={setDate}
              max={today}
              ariaLabel={t("cashPosition.choosePeriod")}
              testId="cash-position-date"
              className="flex items-center gap-1.5 shrink-0 h-8 px-3 rounded-full text-11 font-semibold active:opacity-60"
            />
          </div>

          <div className="flex items-end justify-between gap-3 mt-4">
            <div className="min-w-0">
              <p className="text-10" style={{ color: "var(--text-secondary)" }}>
                {t("cashPosition.recorded")}
              </p>
              {countLoading ? (
                <Skeleton w="90px" h="20px" className="mt-1" />
              ) : (
                <p
                  className="text-18 font-bold tabular-nums mt-0.5 break-words"
                  data-testid="cash-position-recorded"
                >
                  {count ? formatCurrency(count.counted) : "—"}
                </p>
              )}
            </div>
            {variance != null && (
              <p className="text-10 text-end" style={{ color: "var(--text-secondary)" }}>
                {t("admin.variance")}{" "}
                <span
                  className="font-bold tabular-nums"
                  style={{ color: variance === 0 ? "var(--success)" : "var(--error)" }}
                  data-testid="cash-position-variance"
                >
                  {variance > 0 ? "+" : variance < 0 ? "−" : ""}
                  {formatCurrency(Math.abs(variance))}
                </span>
              </p>
            )}
          </div>

          <div className="flex items-end justify-between gap-3 mt-4">
            <div className="min-w-0">
              <p className="text-10 flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
                <span className="size-1.5 rounded-full shrink-0" style={{ background: "var(--success)" }} />
                {t("cashPosition.received")}
              </p>
              <p
                className="text-13 font-bold tabular-nums mt-0.5 break-words"
                style={{ color: flows.received > 0 ? "var(--success)" : "var(--text-primary)" }}
                data-testid="cash-position-received"
              >
                {entries ? formatCurrency(flows.received) : "—"}
              </p>
            </div>
            <div className="min-w-0 text-end">
              <p className="text-10 flex items-center gap-1.5 justify-end" style={{ color: "var(--text-secondary)" }}>
                <span className="size-1.5 rounded-full shrink-0" style={{ background: "var(--error)" }} />
                {t("cashPosition.paid")}
              </p>
              <p
                className="text-13 font-bold tabular-nums mt-0.5 break-words"
                style={{ color: flows.paid > 0 ? "var(--error)" : "var(--text-primary)" }}
                data-testid="cash-position-paid"
              >
                {entries ? formatCurrency(flows.paid) : "—"}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 pt-4">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder={t("cashPosition.search")}
        />
      </div>

      {isOwner && (
        <div className="px-4 pt-3">
          <button
            type="button"
            onClick={openCount}
            disabled={!ready}
            data-testid="cash-position-add"
            className="w-full h-12 rounded-[var(--radius-tile)] flex items-center justify-center gap-2 text-14 font-bold active:opacity-70 disabled:opacity-40"
            style={{ background: "#2c2c2a", color: "var(--brand)" }}
          >
            <Plus size={16} />
            {t("cashPosition.record")}
          </button>
        </div>
      )}

      <div className="flex gap-2 px-4 pt-3 flex-wrap">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setDirection(f.key)}
            aria-pressed={direction === f.key}
            data-testid={`cash-position-filter-${f.key}`}
            className="h-8 px-3.5 rounded-full text-12 font-semibold transition-colors"
            style={
              direction === f.key
                ? { background: "var(--brand)", color: "#0a0a0a" }
                : { background: "var(--tone-sunken)", color: "var(--text-secondary)" }
            }
          >
            {f.label}
          </button>
        ))}
        {refreshing && (
          <span className="text-11 self-center" style={{ color: "var(--text-tertiary)" }}>
            {t("cashPosition.refreshing")}
          </span>
        )}
      </div>

      {!entries ? (
        ledgerFailed ? (
          <p className="px-4 pt-6 text-12" style={{ color: "var(--text-secondary)" }}>
            {t("cashPosition.loadFailed")}
          </p>
        ) : (
          <SkeletonList rows={4} tile />
        )
      ) : rows.length === 0 ? (
        <div className="px-4 pt-10 flex flex-col items-center gap-2">
          <ReceiptText size={28} style={{ color: "var(--text-tertiary)" }} />
          <p className="text-13 text-center" style={{ color: "var(--text-secondary)" }}>
            {search.trim() || direction !== "all" ? t("cashPosition.empty") : t("cashPosition.noRecent")}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-4 pt-3 pb-8">
          {rows.map((entry) => {
            const incoming = entry.direction === "in";
            return (
              <div
                key={entry.id}
                className="rounded-[var(--radius-card)] p-3.5"
                style={{ background: "var(--tone-card)" }}
                data-testid={`cash-position-row-${entry.id}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="size-10 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                  >
                    {incoming ? (
                      <ArrowDownLeft size={16} style={{ color: "var(--success)" }} />
                    ) : (
                      <ArrowUpRight size={16} style={{ color: "var(--error)" }} />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-14 font-bold truncate">{entry.counterparty || "—"}</p>
                    <p className="text-11 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                      {incoming ? t("payments.customerPayment") : t("payments.supplierPayment")}
                      {" · "}
                      {methodLabel(entry.method)}
                    </p>
                  </div>
                  <p
                    className="text-13 font-bold tabular-nums shrink-0"
                    style={{ color: incoming ? "var(--success)" : "var(--error)" }}
                  >
                    {incoming ? "+" : "−"} {formatCurrency(entry.amount)}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3 mt-2">
                  <p className="text-10 truncate" style={{ color: "var(--text-tertiary)" }}>
                    {formatSmartDateTime(entry.createdAt, undefined, t)}
                  </p>
                  <span
                    className="text-10 font-bold px-2 py-0.5 rounded-full shrink-0"
                    style={{
                      color: incoming ? "var(--success)" : "var(--error)",
                      background: "var(--surface-2)",
                    }}
                  >
                    {incoming ? t("cashPosition.received") : t("cashPosition.paid")}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SectionActionsSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={t("cashPosition.title")}
        actions={actions.map((action) => ({
          ...action,
          onClick: () => {
            setMenuOpen(false);
            action.onClick();
          },
        }))}
      />

      <Sheet
        open={cashOpen}
        onClose={() => {
          if (!savingCash) setCashOpen(false);
        }}
        title={t("cashPosition.record")}
        closeButton={false}
      >
        <div className="px-4 pb-4">
          <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
            {t("admin.countedCash")}
          </p>
          <input
            autoFocus
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={cashAmount}
            onChange={(event) => setCashAmount(event.target.value)}
            placeholder="0"
            aria-label={t("admin.countedCash")}
            data-testid="cash-position-count-input"
            className="w-full h-12 rounded-[var(--radius-tile)] px-3 text-18 font-bold tabular-nums outline-none"
            style={{ background: "var(--field-bg)", color: "var(--text-primary)" }}
          />
          <div className="flex gap-2 mt-4">
            <button
              type="button"
              onClick={() => setCashOpen(false)}
              disabled={savingCash}
              className="flex-1 h-12 rounded-[var(--radius-tile)] text-13 font-bold active:opacity-70 disabled:opacity-50"
              style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void saveCount()}
              disabled={savingCash}
              data-testid="cash-position-save"
              className="flex-1 h-12 rounded-[var(--radius-tile)] text-13 font-bold active:opacity-70 disabled:opacity-50"
              style={{ background: "#2c2c2a", color: "var(--brand)" }}
            >
              {savingCash ? t("common.saving") : t("admin.saveReconciliation")}
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
