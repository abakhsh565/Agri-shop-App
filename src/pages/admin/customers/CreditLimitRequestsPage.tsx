import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { formatCurrency } from "@/lib/formatters";
import { getCreditRequestsDB, type LocalCreditRequest } from "@/lib/localGroupRegistry";

type RequestFilter = "all" | "pending" | "approved" | "rejected";

/**
 * Credit limit requests: what employees have asked the owner to raise, and what was decided.
 *
 * SHAPE (owner, 2026-10-30): the state filters, then one card per request carrying the customer,
 * who asked, the limit on record, the limit asked for, the difference, and the reason in the
 * employee's own words. The pending/decided counts and the closing hint are gone: the chips
 * already say how many rows each state holds, and a screen with nothing to decide should say so
 * once, not three times.
 *
 * THE ROWS ARE THE REQUESTS, NOT THE CUSTOMERS. The old screen listed every account with high
 * utilisation, so a line that said "review request" opened a customer profile that said nothing
 * about a request. Here each row is the request itself, and Review opens the screen where the
 * owner can grant a different figure than the employee asked for (0251).
 *
 * "RECENTLY DECIDED" IS THE DATABASE'S STATUS, not a guess from a customer's balance: pending,
 * approved and rejected are the three values the table stores, and the counts are the rows below
 * them.
 */
export default function CreditLimitRequestsPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const [requests, setRequests] = useState<LocalCreditRequest[] | null>(null);
  const [filter, setFilter] = useState<RequestFilter>("all");

  useEffect(() => {
    let live = true;
    getCreditRequestsDB().then((rows) => {
      if (live) setRequests(rows);
    });
    return () => { live = false; };
  }, []);

  const sorted = useMemo(() => {
    if (!requests) return [];
    return [...requests].sort((a, b) => {
      const aPending = a.status === "pending" ? 1 : 0;
      const bPending = b.status === "pending" ? 1 : 0;
      if (aPending !== bPending) return bPending - aPending;
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    });
  }, [requests]);

  const rows = filter === "all" ? sorted : sorted.filter((r) => r.status === filter);

  const filters: { key: RequestFilter; label: string }[] = [
    { key: "all", label: t("products.all") },
    { key: "pending", label: t("receivable.pending") },
    { key: "approved", label: t("creditRequests.approved") },
    { key: "rejected", label: t("creditRequests.rejected") },
  ];

  // Readable in both themes: the pending chip carries the warning TINT and keeps the normal
  // text colour (amber on a pale amber fill was the least legible label on the screen), and
  // approved uses the brand pair the rest of the app uses for a granted state.
  const statusTone = (status: LocalCreditRequest["status"]) =>
    status === "pending"
      ? { color: "var(--text-primary)", bg: "var(--warning-bg)", edge: "var(--warning-border)" }
      : status === "approved"
        ? { color: "var(--brand-dark)", bg: "var(--brand-light)", edge: "transparent" }
        : { color: "var(--error)", bg: "var(--error-bg)", edge: "var(--error-border)" };
  const statusLabel = (status: LocalCreditRequest["status"]) =>
    status === "pending"
      ? t("receivable.pending")
      : status === "approved"
        ? t("creditRequests.approved")
        : t("creditRequests.rejected");

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="credit-requests-page"
    >
      <StatusBar />
      <NavHeader title={t("hub.customers.creditRequests")} backTo={`${base}/settings/hub/customers`} />

      <div className="flex gap-2 px-4 pt-3 pb-3 overflow-x-auto">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className="shrink-0 h-9 px-4 rounded-full text-12 font-semibold transition-colors active:opacity-70"
            style={{
              background: filter === f.key ? "var(--brand)" : "var(--surface-2)",
              color: filter === f.key ? "#0a0a0a" : "var(--text-secondary)",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!requests ? (
        <SkeletonList rows={3} tile />
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-14 gap-2">
          <ShieldCheck size={28} style={{ color: "var(--text-tertiary)" }} />
          <p className="text-14 font-semibold text-center" style={{ color: "var(--text-primary)" }}>
            {requests.length === 0 ? t("creditRequests.empty") : t("creditRequests.emptyFilter")}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-4 pb-8">
          {rows.map((request) => {
            const increase = request.requestedLimit - request.currentLimit;
            const customerSalesLink = `${base}/customers/${request.customerId}`;
            return (
              <div
                key={request.id}
                className="rounded-[var(--radius-card)] p-4"
                style={{ background: "var(--surface)" }}
                data-testid={`credit-request-row-${request.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => navigate(customerSalesLink)}
                      className="text-15 font-semibold truncate text-start active:opacity-70"
                    >
                      {request.customerName}
                    </button>
                    <p className="text-12 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                      {t("creditRequests.requestedBy", { name: request.requestedBy })}
                    </p>
                  </div>
                  <span
                    className="shrink-0 text-10 font-bold px-2 py-0.5 rounded-full"
                    style={{
                      color: statusTone(request.status).color,
                      background: statusTone(request.status).bg,
                      border: `1px solid ${statusTone(request.status).edge}`,
                    }}
                  >
                    {statusLabel(request.status)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div className="min-w-0">
                    <p className="text-10" style={{ color: "var(--text-secondary)" }}>
                      {t("creditRequests.currentLimit")}
                    </p>
                    <p className="text-13 font-semibold mt-0.5 tabular-nums break-words">
                      {formatCurrency(request.currentLimit)}
                    </p>
                  </div>
                  <div className="min-w-0 text-end">
                    <p className="text-10" style={{ color: "var(--text-secondary)" }}>
                      {t("creditRequests.requestedLimit")}
                    </p>
                    <p className="text-13 font-semibold mt-0.5 tabular-nums break-words">
                      {formatCurrency(request.requestedLimit)}
                    </p>
                  </div>
                </div>

                {/* The ask, in one figure. Omitted when the requested limit is not an increase:
                    a negative "increase" is not a decision anyone can act on. */}
                {increase > 0 && (
                  <div
                    className="rounded-[var(--radius-tile)] px-3 py-2 mt-2 flex items-baseline justify-between gap-3"
                    style={{ background: "var(--surface-2)" }}
                  >
                    <p className="text-10" style={{ color: "var(--text-secondary)" }}>
                      {t("creditRequests.increase")}
                    </p>
                    <p className="text-14 font-bold tabular-nums" style={{ color: "var(--brand-dark)" }}>
                      + {formatCurrency(increase)}
                    </p>
                  </div>
                )}

                {request.reason && (
                  <p className="text-12 mt-2 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                      {t("creditRequests.reason")}:
                    </span>{" "}
                    {request.reason}
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => navigate(`${base}/alerts/credit-requests/${request.id}`)}
                  className="w-full h-10 rounded-full text-12 font-semibold mt-3 active:opacity-70"
                  style={
                    request.status === "pending"
                      ? { background: "var(--brand)", color: "#0a0a0a" }
                      : { background: "var(--surface-2)", color: "var(--text-primary)" }
                  }
                >
                  {request.status === "pending"
                    ? t("creditRequests.review")
                    : t("creditRequests.view")}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
