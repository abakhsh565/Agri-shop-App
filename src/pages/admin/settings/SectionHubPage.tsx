import { useNavigate, useParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListRow from "@/components/ui/ListRow";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { hubSection } from "@/lib/settingsHub";

/**
 * One part of the business, opened from the Settings menu.
 *
 * The menu names the part — Sales, Finance, Employees & Access — and this screen is the jobs
 * inside it: the section's name in the bar, then the rows, each opening the ledger or the form
 * it names. Nothing here computes a figure or owns a decision; that stays in the screens the
 * rows lead to, so a number can never mean two things in two places.
 *
 * DELIBERATELY UNBOXED, and with no line under the name (owner's correction, 2026-10-28). The
 * rows sit straight on the page: the screen is the list, and wrapping it in a card added a
 * second edge inside the frame without grouping anything — every row is a different place. The
 * sentence that used to explain the section said what the section's own name already said, and
 * it cost the reader a line before the thing they came for. The row primitive still owns the
 * height, insets and press state, so this is the same row grammar as everywhere else.
 *
 * The rows come from `lib/settingsHub`, the same file the menu reads, so a section cannot list a
 * job the app does not have.
 */
export default function SectionHubPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const { sectionId } = useParams();
  const section = hubSection(sectionId);

  // An address naming no section is not a screen: send it back to the menu rather than drawing an
  // empty list that looks like a section with nothing in it.
  if (!section) {
    navigate(`${base}/settings`, { replace: true });
    return null;
  }

  /**
   * A target may be a screen, or a block that already stands on one (`/settings#settings-preferences`).
   * The fragment is carried in the address rather than acted on here: the screen that holds the
   * block is the one that knows when it has been laid out, and it scrolls itself. A timer fired
   * from this side went off before that screen had drawn, so the row landed on the top of the
   * page with the block it named 1500px below the fold (observed 2026-10-28).
   */
  function open(to: string) {
    navigate(`${base}${to}`);
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="section-hub-page"
      data-section={section.id}
    >
      <StatusBar />
      {/* A step back into Settings, and it says so: opening a section moves forward, so the
          leading control is the arrow that returns rather than a cross that dismisses. */}
      <NavHeader title={t(section.titleKey)} backTo={`${base}/settings`} />

      <div className="pt-1 pb-6">
        {section.rows.map((row) => (
          <ListRow
            key={row.id}
            testId={`hub-row-${row.id}`}
            title={t(row.labelKey)}
            onClick={() => open(row.to)}
            trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
          />
        ))}
      </div>
    </div>
  );
}
