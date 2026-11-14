import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useCustomersStore } from "@/stores/customersStore";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { formatCurrency, formatSmartDateTime } from "@/lib/formatters";
import { getCreditRequestsDB, type LocalCreditRequest } from "@/lib/localGroupRegistry";
import { AlertTriangle, ChevronRight, CheckCircle2 } from "lucide-react";

/**
 * The audit view for a credit exception.
 *
 * The request row owns what was asked for, what the owner actually granted, who granted it and
 * when. The customer row owns the current exposure. Both are shown; neither is reconstructed
 * from the other. A customer flagged automatically (no approved request) still gets the screen,
 * but it does not invent an approval that never happened.
 */
export default function CreditOverrideDetailPage() {
  const navigate = useNavigate();
  const { customerId } = useParams();
  const { language } = useThemeStore();
  const t = useT();
  const isUrdu = language === "ur";
  const customers = useCustomersStore((s) => s.customers);
  const [request, setRequest] = useState<LocalCreditRequest | null>(null);
  const [reviewed, setReviewed] = useState(false);

  useEffect(() => {
    let alive = true;
    getCreditRequestsDB()
      .then((requests) => {
        if (!alive) return;
        const approved = requests
          .filter(
            (item) =>
              item.customerId === customerId &&
              item.status === "approved" &&
              item.reviewedAt,
          )
          .sort(
            (a, b) =>
              new Date(b.reviewedAt ?? 0).getTime() -
              new Date(a.reviewedAt ?? 0).getTime(),
          )[0];
        setRequest(approved ?? null);
      })
      .catch(() => {
        if (alive) setRequest(null);
      });
    return () => {
      alive = false;
    };
  }, [customerId]);

  const customer = customers.find((c) => c.id === customerId);
  if (!customer) {
    return (
      <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("creditOverride.title")} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {t("admin.customerNotFound")}
          </p>
        </div>
      </div>
    );
  }

  const utilization = customer.creditLimit > 0
    ? Math.round((customer.outstandingBalance / customer.creditLimit) * 100)
    : 0;
  const approvedAmount = request ? request.approvedLimit ?? request.requestedLimit : null;
  const when = request?.reviewedAt ?? request?.createdAt ?? null;

  const rows: { label: string; value: React.ReactNode }[] = [
    ...(request
      ? [
          {
            label: t("creditOverride.approvedBy"),
            value: request.reviewedBy ?? "—",
          },
        ]
      : []),
    {
      label: t("creditOverride.customer"),
      value: (
        <span className="flex items-center gap-2">
          {customer.name}
          <span
            className="text-10 font-bold px-2 py-0.5 rounded-full"
            style={{ background: "var(--error-bg)", color: "var(--error)" }}
          >
            {t("creditOverride.red")}
          </span>
        </span>
      ),
    },
    ...(request && approvedAmount != null
      ? [
          {
            label: t("creditOverride.approvedAmount"),
            value: formatCurrency(approvedAmount),
          },
          {
            label: t("creditOverride.requestedAmount"),
            value: formatCurrency(request.requestedLimit),
          },
          {
            label: t("creditOverride.previousLimit"),
            value: formatCurrency(request.currentLimit),
          },
        ]
      : []),
    {
      label: t("creditOverride.outstandingNow"),
      value: formatCurrency(customer.outstandingBalance),
    },
    ...(when
      ? [
          {
            label: t("common.when"),
            value: formatSmartDateTime(when, undefined, t),
          },
        ]
      : []),
  ];

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("creditOverride.title")} />

      <div className="flex flex-col gap-3 px-4 pt-4 pb-8">
        <div
          className="flex items-start gap-3 rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--error-bg)" }}
        >
          <AlertTriangle size={20} className="mt-0.5 shrink-0" style={{ color: "var(--error)" }} />
          <p className="text-14 font-medium leading-relaxed" style={{ color: "var(--error)" }}>
            {request ? t("creditOverride.approvedForRed") : t("creditOverride.flaggedAuto")}
          </p>
        </div>

        <ListCard>
          {rows.map((row) => (
            <ListRow
              key={row.label}
              trailing={
                <span className="text-14 font-medium" style={{ color: "var(--text-primary)" }}>
                  {row.value}
                </span>
              }
            >
              <span className="text-12" style={{ color: "var(--text-secondary)" }}>
                {row.label}
              </span>
            </ListRow>
          ))}
        </ListCard>

        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--surface)" }}
        >
          <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
            {t("creditOverride.whyFlagged")}
          </p>
          <p className="text-14 leading-relaxed" style={{ color: "var(--text-primary)" }}>
            {utilization >= 100
              ? t("creditOverride.reasonAtLimit", {
                  name: customer.name,
                  limit: formatCurrency(customer.creditLimit),
                  outstanding: formatCurrency(customer.outstandingBalance),
                  pct: String(utilization),
                })
              : t("creditOverride.reasonApproaching", {
                  name: customer.name,
                  limit: formatCurrency(customer.creditLimit),
                  outstanding: formatCurrency(customer.outstandingBalance),
                  pct: String(utilization),
                })}
          </p>
        </div>

        <button
          onClick={() =>
            navigate(isUrdu ? `/employees/customers/${customer.id}` : `/admin/customers/${customer.id}`)
          }
          className="flex items-center justify-between px-4 py-3.5 rounded-[var(--radius-card)]"
          style={{ background: "var(--surface)" }}
        >
          <span className="text-14 font-medium" style={{ color: "var(--text-primary)" }}>
            {t("creditOverride.viewProfile")}
          </span>
          <ChevronRight size={16} style={{ color: "var(--text-secondary)" }} />
        </button>

        {reviewed ? (
          <div className="flex items-center justify-center gap-2 py-3">
            <CheckCircle2 size={18} style={{ color: "var(--brand-dark)" }} />
            <span className="text-14 font-medium" style={{ color: "var(--brand-dark)" }}>
              {t("creditOverride.reviewed")}
            </span>
          </div>
        ) : (
          <button
            onClick={() => setReviewed(true)}
            className="w-full py-3 text-center"
          >
            <span className="text-14 font-medium" style={{ color: "var(--brand-dark)" }}>
              {t("creditOverride.markReviewed")}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
