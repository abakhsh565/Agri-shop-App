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
import { AlertTriangle, ChevronRight, CheckCircle2 } from "lucide-react";

export default function CreditOverrideDetailPage() {
  const navigate = useNavigate();
  const { customerId } = useParams();
  const { language } = useThemeStore();
  const t = useT();
  const isUrdu = language === "ur";
  const customers = useCustomersStore((s) => s.customers);
  const loadCreditLimitRequests = useCustomersStore((s) => s.loadCreditLimitRequests);
  const [reviewed, setReviewed] = useState(false);
  // Who actually approved this override. This screen used to print the literal name
  // "Yaqoob Malik" for every customer, which told the owner a specific person had
  // approved it when nobody had.
  const [approvedBy, setApprovedBy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadCreditLimitRequests()
      .then((requests) => {
        if (!alive) return;
        const approved = requests.find(
          (r) => r.customerId === customerId && r.status === "approved" && r.reviewedBy,
        );
        setApprovedBy(approved?.reviewedBy ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [customerId, loadCreditLimitRequests]);

  const customer = customers.find((c) => c.id === customerId);
  if (!customer) {
    return (
      <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("creditOverride.title")} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("admin.customerNotFound")}</p>
        </div>
      </div>
    );
  }

  const utilization = customer.creditLimit > 0
    ? Math.round((customer.outstandingBalance / customer.creditLimit) * 100)
    : 0;

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("creditOverride.title")} />

      <div className="flex flex-col gap-3 px-4 pt-4 pb-8">
        {/* Warning banner */}
        <div
          className="flex items-start gap-3 rounded-[var(--radius-card)] p-4"
          style={{ background: "#FCEBEB" }}
        >
          <AlertTriangle size={20} color="#A32D2D" className="mt-0.5 shrink-0" />
          <p className="text-14 font-medium" style={{ color: "#791F1F", lineHeight: 1.5 }}>
            {t("creditOverride.approvedForRed")}
          </p>
        </div>

        {/* Override details */}
        <ListCard>
          {[
            ...(approvedBy ? [{ label: t("creditOverride.approvedBy"), value: approvedBy }] : []),
            {
              label: t("creditOverride.customer"),
              value: (
                <span className="flex items-center gap-2">
                  {customer.name}
                  <span
                    className="text-10 font-bold px-2 py-0.5 rounded-full"
                    style={{ background: "#FEE2E2", color: "#DC2626" }}
                  >
                    {t("creditOverride.red")}
                  </span>
                </span>
              ),
            },
            { label: t("common.amount"), value: formatCurrency(customer.outstandingBalance) },
            { label: t("common.when"), value: formatSmartDateTime(customer.createdAt, undefined, t) },
          ].map((row) => (
            <ListRow
              key={row.label}
              trailing={
                <span className="text-14 font-medium" style={{ color: "var(--text-primary)" }}>
                  {row.value}
                </span>
              }
            >
              <span className="text-13" style={{ color: "var(--text-secondary)" }}>
                {row.label}
              </span>
            </ListRow>
          ))}
        </ListCard>

        {/* Why flagged */}
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--tone-card)" }}
        >
          <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
            {t("creditOverride.whyFlagged")}
          </p>
          <p className="text-14 leading-relaxed" style={{ color: "var(--text-primary)" }}>
            {utilization >= 100
              ? t("creditOverride.reasonAtLimit", { name: customer.name, limit: formatCurrency(customer.creditLimit), outstanding: formatCurrency(customer.outstandingBalance), pct: String(utilization) })
              : t("creditOverride.reasonApproaching", { name: customer.name, limit: formatCurrency(customer.creditLimit), outstanding: formatCurrency(customer.outstandingBalance), pct: String(utilization) })}
          </p>
        </div>

        {/* View customer profile */}
        <button
          onClick={() => navigate(isUrdu ? `/employees/customers/${customer.id}` : `/admin/customers/${customer.id}`)}
          className="flex items-center justify-between px-4 py-3.5 rounded-[var(--radius-card)]"
          style={{ background: "var(--tone-card)" }}
        >
          <span className="text-14 font-medium" style={{ color: "var(--text-primary)" }}>
            {t("creditOverride.viewProfile")}
          </span>
          <ChevronRight size={16} style={{ color: "var(--text-secondary)" }} />
        </button>

        {/* Mark as reviewed */}
        {reviewed ? (
          <div className="flex items-center justify-center gap-2 py-3">
            <CheckCircle2 size={18} style={{ color: "var(--brand-dark, #65a30d)" }} />
            <span className="text-14 font-medium" style={{ color: "var(--brand-dark, #65a30d)" }}>
              {t("creditOverride.reviewed")}
            </span>
          </div>
        ) : (
          <button
            onClick={() => setReviewed(true)}
            className="w-full py-3 text-center"
          >
            <span className="text-14 font-medium" style={{ color: "var(--brand-dark, #65a30d)" }}>
              {t("creditOverride.markReviewed")}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
