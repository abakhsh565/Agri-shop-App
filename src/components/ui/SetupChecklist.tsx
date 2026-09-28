import { useNavigate } from "react-router-dom";
import { Check, ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
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
  returnTo,
  onAction,
}: {
  className?: string;
  testId?: string;
  /**
   * Where a create screen comes back to. Omitted, it is this screen — the Home and Settings
   * behaviour, unchanged. The setup flow passes its own path, so adding a supplier from inside
   * the flow returns to the flow instead of to Home.
   */
  returnTo?: string;
  /**
   * Take over the tap instead of navigating.
   *
   * The setup flow renders this checklist inside a bottom sheet, and a sheet has to be closed
   * before the create screen can be seen — a decision that belongs to whoever mounted the
   * card, not to the card. Without this seam the flow would either have to leave the sheet
   * covering the screen it just opened, or restate the whole checklist to get one hook. The
   * destination is unchanged: it is still the one the dependency graph computed.
   */
  onAction?: (to: string) => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  // The arrow beside an action has to follow the words, so its direction is decided from the
  // language rather than by the screen's own pair of utilities.
  const isUrdu = useThemeStore((s) => s.language) === "ur";
  const { items, doneCount, total, complete, ready } = useSetupStatus({ returnTo });

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
        <div className="px-4 pt-4 pb-3 flex items-start gap-3">
          {/* Home only, so this heading is sized for Home: 14 — two steps down from the 16 it
              shipped with, at the owner's request, so the whole widget reads smaller against
              the cards below it. Settings keeps its own 14 for the same reason. */}
          <div className="flex-1 min-w-0">
            <p className="text-14 font-bold truncate" style={{ color: "var(--text-primary)" }}>
              {/* A small congratulations mark beside the title. Decorative only: no text, so
                  nothing to translate, and it is hidden from a screen reader rather than read
                  out as "party popper" between the heading and the count. `me-1` is the logical
                  margin, so it sits on the correct side in Urdu. */}
              <span aria-hidden="true" className="me-1">🎉</span>
              {t("setup.title")}
            </p>
            {/* What the list is for, in the owner's terms. The heading names the goal; this
                says this card is the way there, so the rows below read as steps rather than
                as a menu. */}
            <p className="text-11 mt-0.5 leading-snug" style={{ color: "var(--text-secondary)" }}>
              {t("setup.subtitle")}
            </p>
          </div>
          {/* Numerals: no translation, and it cannot fall out of step with the check marks
              because both are counted from the same list. Tabular figures keep the chip the
              same width as the count changes, so the heading never shifts. */}
          <span
            className="text-11 font-bold shrink-0 whitespace-nowrap"
            style={{
              background: "var(--tone-sunken)",
              color: "var(--text-secondary)",
              borderRadius: 999,
              padding: "3px 9px",
              fontVariantNumeric: "tabular-nums",
            }}
            data-testid="setup-progress"
          >
            {ready ? t("setup.progress", { done: String(doneCount), total: String(total) }) : "–"}
          </span>
        </div>

        {items.map((item) => (
          <ListRow
            key={item.id}
            tile={
              /* A done step is a solid mark, a step still to do is an open one — the same
                 reading as the reference card, where finished steps carry a filled disc and
                 the last open one is drawn as a dashed circle. The open ring is a box-shadow
                 rather than a border: browsers snap border widths to whole device pixels, so
                 at DPR 1.25 a 1.5px border renders as 0.8px — a hairline that disappears on a
                 light card. Shadows are drawn at subpixel weight, so the ring reads the same
                 on every screen density. */
              <span
                className="size-5 rounded-full flex items-center justify-center shrink-0"
                style={
                  item.done
                    ? { background: "var(--ink)", color: "var(--ink-fg)" }
                    : { boxShadow: "inset 0 0 0 1.5px var(--border-control)", border: "1px dashed var(--divider)" }
                }
                data-testid={`setup-mark-${item.id}`}
                aria-hidden="true"
              >
                {item.done && <Check size={13} strokeWidth={3} />}
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
                data-testid={`setup-step-${item.id}`}
              >
                {/* A finished step is stated as the thing that is now true, not as the
                    absence it was before: "No suppliers yet" with a tick on it contradicts
                    itself, which is what the same row read before this. */}
                {item.done ? t(`setup.done.${item.id}`) : item.title}
              </p>
              {!item.done && item.action && (
                <button
                  onClick={() => (onAction ? onAction(item.action!.to) : navigate(item.action!.to))}
                  data-testid={`setup-action-${item.id}`}
                  className="text-12 font-bold shrink-0 ds-pressable inline-flex items-center gap-0.5"
                  style={{ color: "var(--brand)" }}
                >
                  {item.action.label}
                  {/* The arrow says the words are a door, not a label. It is turned round in
                      Urdu, where "onwards" points the other way. */}
                  <ChevronRight size={13} className={isUrdu ? "rotate-180" : ""} />
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
