import { useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useSetupStatus } from "@/lib/setupStatus";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import Skeleton from "@/components/ui/Skeleton";

/**
 * Business setup, as a checklist: every required step is shown, the ones that are done carry
 * a check mark, and the ones still to do carry the action that creates them.
 *
 * Why a checklist after three other shapes: a percentage says how much is left but not *what*
 * is left, and a single "next step" hides the two steps behind it, so a new owner cannot see
 * the shape of the job. Showing all three with a check mark answers "what do I still have to
 * do?" in one glance, which is the only question this card exists to answer.
 *
 * Each step is a `ListRow`, so the three are separated by the card's own hairline and spaced
 * by the row's own padding — the same line and rhythm every other list in the app uses,
 * rather than a gap this card invented. The header is the card's first child, so the first
 * step draws a line under it and the heading is not crowded against the list.
 *
 * A done step keeps its check and its name and drops the rest — the reason and the button
 * were only ever useful while the step was open. Steps further down the order are still
 * listed, because the in-flow dependency action can carry the user through them (creating a
 * product with no supplier offers to add the supplier first).
 *
 * This is the Home shape only. Settings carries the same facts as one progress line
 * (`SetupProgress`), because there the card sits among rows the owner came to change and
 * must not outrank them. Two shapes, one derivation (`useSetupStatus`) and one set of words,
 * so the same missing supplier reads the same in both and the counts cannot diverge.
 *
 * Renders nothing at all once the shop can trade.
 */
export default function SetupChecklist({
  className = "",
  testId = "setup-checklist",
}: {
  className?: string;
  testId?: string;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { items, doneCount, total, complete, ready } = useSetupStatus();

  if (ready && complete) return null;

  return (
    <div data-testid={testId} className={className}>
      <ListCard>
        <div className="px-4 pt-3.5 pb-3 flex items-baseline gap-2">
          {/* 16, a step above the Settings card's 14: this is the one card on an empty Home,
              and it carries three rows plus an action, so its heading is a heading. */}
          <p className="text-16 font-bold flex-1 min-w-0" style={{ color: "var(--text-primary)" }}>
            {t("setup.title")}
          </p>
          {/* Numerals: no translation, and it cannot fall out of step with the check marks
              because both are counted from the same list. */}
          <span className="text-12 shrink-0" style={{ color: "var(--text-tertiary)" }} data-testid="setup-progress">
            {ready ? `${doneCount}/${total}` : "–"}
          </span>
        </div>

        {items.map((item) => (
          <ListRow
            key={item.id}
            tile={
              /* The empty ring is a box-shadow, not a border: browsers snap border widths to
                 whole device pixels, so at DPR 1.25 a 1.5px border renders as 0.8px — a
                 hairline that disappears on a light card. Shadows are drawn at subpixel
                 weight, so the ring reads the same on every screen density. */
              <span
                className="size-5 rounded-full flex items-center justify-center shrink-0"
                style={
                  item.done
                    ? { background: "var(--brand)" }
                    : { boxShadow: "inset 0 0 0 1.5px var(--border-control)" }
                }
              >
                {item.done && <Check size={13} strokeWidth={3} style={{ color: "#0a0a0a" }} />}
              </span>
            }
            trailing={
              !item.done && item.action ? (
                <button
                  onClick={() => navigate(item.action!.to)}
                  className="text-12 font-bold shrink-0 ds-pressable"
                  style={{ color: "var(--brand)" }}
                >
                  {item.action.label}
                </button>
              ) : undefined
            }
          >
            <p
              className={item.done ? "text-14" : "text-14 font-semibold"}
              style={{ color: item.done ? "var(--text-secondary)" : "var(--text-primary)" }}
            >
              {item.title}
            </p>
            {!item.done && (
              <p className="text-12 mt-1 leading-snug" style={{ color: "var(--text-secondary)" }}>
                {item.action ? item.why : (item.instead ?? item.why)}
              </p>
            )}
          </ListRow>
        ))}

        {!ready && (
          <div className="px-4 pb-3.5">
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
      </ListCard>
    </div>
  );
}
