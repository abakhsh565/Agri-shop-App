import { MessageSquare } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import EmptyState from "@/components/ui/EmptyState";
import { useT } from "@/lib/i18n";

/**
 * Messages — the bottom bar's fifth tab, in the slot the More tab used to hold.
 *
 * WHAT IT IS FOR (owner's decision, 2026-10-18). This screen is the home for two conversations
 * that are the same shape: a farmer asking a shop for stock and talking to the owner about it,
 * and members of one shop messaging each other. Both need a thread, a sender and a time — which
 * is why they share one surface rather than two.
 *
 * WHAT IT IS TODAY. Nothing is wired to a table yet, so the screen says that plainly instead of
 * showing an empty list that reads like a bug. There is deliberately no "send" control and no
 * store behind it: a message button that silently wrote nowhere would be worse than this page.
 * The tab exists now because the navigation is what the owner asked to settle first — the rows
 * that used to be behind More now live on the account screen, and this slot is theirs.
 *
 * Nothing here reads or writes the database, so it cannot be the reason a shop sees wrong data.
 */
export default function AdminMessagesPage() {
  const t = useT();

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />
      {/* A tab destination: the header carries the title, and back leaves through the dashboard
          the way every other top-level screen does — no back affordance is faked here. */}
      <NavHeader title={t("admin.messages")} noBack />

      <EmptyState
        icon={MessageSquare}
        title={t("messages.emptyTitle")}
        subtitle={t("messages.emptyHint")}
      />

      <div className="pb-6" />
    </div>
  );
}
