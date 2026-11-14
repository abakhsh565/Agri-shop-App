import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CalendarDays, ChevronRight, Sprout } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useCustomersStore } from "@/stores/customersStore";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { loadBusinessSettings } from "@/lib/reminderEngine";
import { supabase } from "@/lib/supabase";
import { nextHarvestWindow } from "@/lib/quickAlerts";
import type { CropConfig } from "@/types";

function initials(name: string): string {
  return (
    name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

/**
 * The harvest alert is a worklist, not a notification.
 *
 * The owner needs the season date, how many farmers it touches and who still owes money.
 * The list opens each customer's own ledger; the primary action hands the reader to the
 * existing ready-follow-ups queue, where the send sheet already owns composing a message.
 */
export default function HarvestAlertPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const customers = useCustomersStore((s) => s.customers);
  const customersReady = useCustomersStore((s) => s.ready);
  const loadCustomers = useCustomersStore((s) => s.load);

  const [crops, setCrops] = useState<CropConfig[]>([]);
  const [cropsByCustomer, setCropsByCustomer] = useState<Record<string, string[]>>({});
  const [dataReady, setDataReady] = useState(false);

  useEffect(() => {
    if (!customersReady) void loadCustomers();
  }, [customersReady, loadCustomers]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [settings, cropRows] = await Promise.all([
          loadBusinessSettings(),
          supabase.from("customer_crops").select("customer_id, crop_name"),
        ]);
        if (!alive) return;
        setCrops(Array.isArray(settings.crops) ? settings.crops : []);
        const map: Record<string, string[]> = {};
        for (const row of cropRows.data ?? []) {
          if (!row.customer_id || !row.crop_name) continue;
          (map[row.customer_id] ??= []).push(row.crop_name);
        }
        setCropsByCustomer(map);
      } catch {
        if (alive) {
          setCrops([]);
          setCropsByCustomer({});
        }
      } finally {
        if (alive) setDataReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const selectedCrop = (location.state as { crop?: string } | null)?.crop;
  const harvest = useMemo(() => {
    const nearest = nextHarvestWindow(crops, customers, cropsByCustomer, new Date(), 400);
    if (!selectedCrop || !nearest || nearest.crop.name === selectedCrop) return nearest;
    const crop = crops.find((item) => item.name === selectedCrop);
    if (!crop) return nearest;
    return nextHarvestWindow([crop], customers, cropsByCustomer, new Date(), 400);
  }, [crops, customers, cropsByCustomer, selectedCrop]);

  const loading = !dataReady || !customersReady;

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("harvestAlert.title")} />

      <div className="flex flex-col gap-4 px-4 pt-4 pb-8">
        {loading ? (
          <SkeletonList rows={4} tile />
        ) : !harvest ? (
          <div
            className="rounded-[var(--radius-card)] p-6 flex flex-col items-center text-center gap-2"
            style={{ background: "var(--surface)" }}
          >
            <div
              className="size-12 rounded-full flex items-center justify-center"
              style={{ background: "var(--warning-bg)", color: "var(--warning)" }}
            >
              <CalendarDays size={22} />
            </div>
            <p className="text-15 font-semibold" style={{ color: "var(--text-primary)" }}>
              {t("harvestAlert.noSeason")}
            </p>
            <p className="text-12" style={{ color: "var(--text-secondary)" }}>
              {t("harvestAlert.noSeasonBody")}
            </p>
            <button
              type="button"
              onClick={() => navigate("/admin/settings")}
              className="mt-2 h-10 px-5 rounded-full text-13 font-semibold"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              {t("harvestAlert.openSettings")}
            </button>
          </div>
        ) : (
          <>
            <section
              className="rounded-[var(--radius-card)] p-5"
              style={{ background: "var(--warning-bg)" }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="size-10 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: "var(--surface)", color: "var(--warning)" }}
                >
                  <Sprout size={20} strokeWidth={1.8} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
                    {t("harvestAlert.nextSeason")}
                  </p>
                  <p
                    className="text-20 font-semibold leading-tight mt-0.5"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {harvest.crop.name}
                  </p>
                  <p className="text-13 mt-1" style={{ color: "var(--text-secondary)" }}>
                    {harvest.days === 1
                      ? t("harvestAlert.daysOne")
                      : t("harvestAlert.days", { count: String(harvest.days) })}
                  </p>
                </div>
                <div className="shrink-0 text-end">
                  <p className="text-10" style={{ color: "var(--text-tertiary)" }}>
                    {t("harvestAlert.harvestDate")}
                  </p>
                  <p className="text-12 font-semibold" style={{ color: "var(--text-primary)" }}>
                    {formatDate(harvest.date)}
                  </p>
                </div>
              </div>
            </section>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-[var(--radius-tile)] p-4" style={{ background: "var(--surface)" }}>
                <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
                  {t("harvestAlert.farmersDue")}
                </p>
                <p className="text-22 font-semibold mt-1" style={{ color: "var(--text-primary)" }}>
                  {harvest.farmers.length}
                </p>
              </div>
              <div className="rounded-[var(--radius-tile)] p-4" style={{ background: "var(--surface)" }}>
                <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
                  {t("harvestAlert.outstanding")}
                </p>
                <p className="text-16 font-semibold mt-1" style={{ color: "var(--error)" }}>
                  {formatCurrency(harvest.outstanding)}
                </p>
              </div>
            </div>

            <section className="rounded-[var(--radius-card)] p-4" style={{ background: "var(--surface)" }}>
              <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
                {t("harvestAlert.intentTitle")}
              </p>
              <p className="text-13 leading-relaxed" style={{ color: "var(--text-primary)" }}>
                {t("harvestAlert.intentBody")}
              </p>
            </section>

            <div>
              <p className="ds-section-label mb-2 px-1" style={{ color: "var(--text-secondary)" }}>
                {t("harvestAlert.listTitle")}
              </p>
              {harvest.farmers.length === 0 ? (
                <div className="rounded-[var(--radius-card)] p-6 text-center" style={{ background: "var(--surface)" }}>
                  <p className="text-14 font-semibold" style={{ color: "var(--text-primary)" }}>
                    {t("harvestAlert.empty")}
                  </p>
                  <p className="text-12 mt-1" style={{ color: "var(--text-secondary)" }}>
                    {t("harvestAlert.emptyBody")}
                  </p>
                </div>
              ) : (
                <ListCard>
                  {harvest.farmers.map((customer) => (
                    <ListRow
                      key={customer.id}
                      onClick={() => navigate(`/admin/customers/${customer.id}`)}
                      tile={
                        <div
                          className="size-9 rounded-full flex items-center justify-center text-11 font-bold shrink-0"
                          style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                        >
                          {initials(customer.name)}
                        </div>
                      }
                      trailing={
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-13 font-semibold" style={{ color: "var(--error)" }}>
                            {formatCurrency(customer.outstandingBalance)}
                          </span>
                          <ChevronRight
                            size={14}
                            style={{
                              color: "var(--text-secondary)",
                              transform: isUrdu ? "rotate(180deg)" : "none",
                            }}
                          />
                        </div>
                      }
                    >
                      <p className="text-14 font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                        {customer.name}
                      </p>
                      <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                        {customer.phone}
                      </p>
                    </ListRow>
                  ))}
                </ListCard>
              )}
            </div>

            <button
              type="button"
              onClick={() =>
                navigate("/admin/alerts/reminders", { state: { tab: "followups", subTab: "ready" } })
              }
              className="h-12 rounded-full text-14 font-bold"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              {t("harvestAlert.openFollowups")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
