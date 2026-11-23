import { useEffect, useState } from "react";
import { tNow } from "@/lib/i18n";
import { CalendarClock, MapPin, Phone } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import Sheet from "@/components/ui/Sheet";
import Skeleton from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import { useT } from "@/lib/i18n";
import { formatDateTime } from "@/lib/formatters";
import { whatsappShareUrl } from "@/lib/appInvite";
import { useFarmerMessagesStore, type MyVisit } from "@/stores/farmerMessagesStore";

/**
 * The visits the owner has booked for this employee.
 *
 * WHY IT EXISTS. `assigned_to` was a column nobody could see from the other end: the owner could
 * name an officer and the officer was never told. This screen asks the database for exactly the
 * rows assigned to the caller (`list_my_farmer_visits`), so an employee cannot read another
 * officer's visits even by guessing an id.
 *
 * WHAT IT DELIBERATELY LEAVES OUT. No price, no credit, no customer record — the officer is
 * going to look at a crop. The two actions are the two the RPC already authorises for him:
 * on the way, and visited.
 */
export default function MyVisitsPage() {
  const t = useT();
  const visits = useFarmerMessagesStore((s) => s.myVisits);
  const loading = useFarmerMessagesStore((s) => s.myVisitsLoading);
  const load = useFarmerMessagesStore((s) => s.loadMyVisits);
  const advanceVisit = useFarmerMessagesStore((s) => s.advanceVisit);

  const [open, setOpen] = useState<MyVisit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void load().catch(() => setError(tNow("messages.actionFailed")));
    // `t` is deliberately not a dependency: it is a new function each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  async function move(visit: MyVisit, status: "in_progress" | "completed") {
    setBusy(true);
    setError("");
    try {
      await advanceVisit(visit.id, status, null);
      setOpen(null);
      await load();
    } catch {
      setError(t("messages.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />
      <NavHeader title={t("messages.myVisits")} backTo="/employee/dashboard" />

      {error && (
        <p className="px-4 pb-2 text-12" style={{ color: "var(--error)" }}>
          {error}
        </p>
      )}

      {loading && visits.length === 0 ? (
        <div className="px-4 flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : visits.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={t("messages.myVisitsEmpty")}
          subtitle={t("messages.myVisitsEmptyHint")}
        />
      ) : (
        <div className="px-4 pb-8">
          <ListCard section={`${t("messages.myVisits")} · ${visits.length}`}>
            {visits.map((visit) => (
              <ListRow
                key={visit.id}
                testId={`my-visit-${visit.id}`}
                icon={CalendarClock}
                onClick={() => setOpen(visit)}
                title={visit.farmer_name}
                meta={
                  <span className="inline-flex items-center gap-1 truncate">
                    <MapPin size={12} strokeWidth={1.5} />
                    {visit.farmer_village ?? visit.purpose}
                  </span>
                }
                value={
                  visit.status === "in_progress"
                    ? t("messages.statusInProgress")
                    : visit.scheduled_for
                      ? formatDateTime(visit.scheduled_for)
                      : t("messages.notScheduled")
                }
              />
            ))}
          </ListCard>
        </div>
      )}

      <Sheet open={Boolean(open)} title={open?.farmer_name ?? ""} onClose={() => setOpen(null)}>
        {open && (
          <div className="px-4 pb-6 flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-11" style={{ color: "var(--text-secondary)" }}>
                {t("messages.purpose")}
              </span>
              <span className="text-14">{open.purpose}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-11" style={{ color: "var(--text-secondary)" }}>
                {t("messages.visitTime")}
              </span>
              <span className="text-14">
                {open.scheduled_for ? formatDateTime(open.scheduled_for) : t("messages.notScheduled")}
              </span>
            </div>
            {open.preferred_window && (
              <div className="flex flex-col gap-1">
                <span className="text-11" style={{ color: "var(--text-secondary)" }}>
                  {t("messages.preferredWindow")}
                </span>
                <span className="text-14">{open.preferred_window}</span>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <span className="text-11" style={{ color: "var(--text-secondary)" }}>
                {t("messages.farmerPhone")}
              </span>
              <span className="text-14">{open.farmer_phone}</span>
            </div>
            {open.owner_note && (
              <div className="flex flex-col gap-1">
                <span className="text-11" style={{ color: "var(--text-secondary)" }}>
                  {t("messages.note")}
                </span>
                <span className="text-14">{open.owner_note}</span>
              </div>
            )}

            <div className="flex flex-col gap-2 pt-1">
              {open.status === "scheduled" ? (
                <Button fullWidth loading={busy} onClick={() => void move(open, "in_progress")} testId="visit-start">
                  {t("messages.startVisit")}
                </Button>
              ) : (
                <Button fullWidth loading={busy} onClick={() => void move(open, "completed")} testId="visit-complete">
                  {t("messages.completeVisit")}
                </Button>
              )}
              <Button
                variant="outline"
                fullWidth
                onClick={() => window.open(whatsappShareUrl(open.farmer_phone, ""), "_blank", "noopener")}
              >
                <span className="inline-flex items-center gap-2">
                  <Phone size={15} strokeWidth={1.5} />
                  {t("messages.callFarmer")}
                </span>
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
