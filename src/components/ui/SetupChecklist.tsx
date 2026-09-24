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
        {/*
          * Header: symmetric padding, and the count as a chip rather than loose text.
          *
          * What it looked like before: `pt-3.5 pb-3` with the `0/3` sitting on the title's
          * baseline, so the top of the card read more cramped than its own bottom and the
          * number floated like a stray glyph. Centre-aligned rows with an even 16/12 rhythm,
          * and a tonal pill for the count, give the card a left and a right — the shape every
          * other list in the app has. Nothing moved: same heading, same rows, same actions.
          */}
        <div className="px-4 pt-4 pb-3 flex items-center gap-3">
          {/* Home only, so this heading is sized for Home: 14 — two steps down from the 16 it
              shipped with, at the owner's request, so the whole widget reads smaller against
              the cards below it. Settings keeps its own 14 for the same reason. */}
          <p className="text-14 font-bold flex-1 min-w-0 truncate" style={{ color: "var(--text-primary)" }}>
            {/* A small congratulations mark beside the title. Decorative only: no text, so
                nothing to translate, and it is hidden from a screen reader rather than read
                out as "party popper" between the heading and the count. `me-1` is the logical
                margin, so it sits on the correct side in Urdu. */}
            <span aria-hidden="true" className="me-1">🎉</span>
            {t("setup.title")}
          </p>
          {/* Numerals: no translation, and it cannot fall out of step with the check marks
              because both are counted from the same list. Tabular figures keep the chip the
              same width as the count changes, so the heading never shifts. */}
          <span
            className="text-12 font-bold shrink-0"
            style={{
              background: "var(--tone-sunken)",
              color: "var(--text-secondary)",
              borderRadius: 999,
              padding: "3px 9px",
              fontVariantNumeric: "tabular-nums",
            }}
            data-testid="setup-progress"
          >
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
          >
            {/* The action sits beside the step it completes, not pinned to the card's far
                edge. A trailing button left a gap the width of the title between the two, so
                the row read as a label and a stray link; and it matches the Settings variant
                (`SetupProgress`), where the action lives in the same text column as the words
                it belongs to. */}
            <div className="flex items-center gap-2 min-w-0">
              <p
                className={`text-12 min-w-0 truncate ${item.done ? "" : "font-semibold"}`}
                style={{ color: item.done ? "var(--text-secondary)" : "var(--text-primary)" }}
              >
                {item.title}
              </p>
              {!item.done && item.action && (
                <button
                  onClick={() => navigate(item.action!.to)}
                  className="text-12 font-bold shrink-0 ds-pressable"
                  style={{ color: "var(--brand)" }}
                >
                  {item.action.label}
                </button>
              )}
            </div>
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
