import { useNavigate } from "react-router-dom";
import { ChevronRight, Store } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useSetupStatus } from "@/lib/setupStatus";
import { useDir } from "@/lib/dirContext";
import ListCard from "@/components/ui/ListCard";
import Skeleton from "@/components/ui/Skeleton";

/**
 * Business setup as a single progress line — the Settings variant.
 *
 * Settings is a list of rows that answer "what can I change", so its setup card must not
 * outrank them: the mark, the name, how far along, the one reason that matters, a bar, and
 * the action as plain brand text. The checklist belongs to Home (`SetupChecklist`), where a
 * new owner has nothing else to look at and the individual steps are the useful information.
 * Two shapes, one derivation and one set of words — the same missing supplier reads the same
 * in both, and the counts cannot diverge.
 *
 * Renders nothing once the shop can trade.
 */
export default function SetupProgress({ className = "" }: { className?: string }) {
  const t = useT();
  const navigate = useNavigate();
  const { isRtl } = useDir();
  const { items, doneCount, total, complete, ready } = useSetupStatus();

  if (ready && complete) return null;

  const next = items.find((i) => !i.done);
  const action = next?.action;
  const body = next ? (action ? next.why : (next.instead ?? next.why)) : undefined;
  const progress = total ? doneCount / total : 0;

  return (
    <div data-testid="setup-checklist" className={className}>
      <ListCard>
        <div className="px-4 py-3.5 flex items-start gap-2.5">
          {/* A mark, not decoration: it names the block at a glance on a page of rows. The
              glyph is `--ink` — black on the light tint, brand on the dark one — because
              `--brand-dark` is a light-theme olive and vanished against the dark card. */}
          <span
            className="size-8 rounded-full flex items-center justify-center shrink-0"
            style={{
              background: "color-mix(in srgb, var(--brand) 16%, transparent)",
              color: "var(--ink)",
            }}
          >
            <Store size={17} strokeWidth={1.8} />
          </span>

          {/* The title and the reason share one left edge, so the two lines read as one
              block beside the mark instead of the reason starting out under the icon. */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <p className="text-14 font-bold flex-1 min-w-0" style={{ color: "var(--text-primary)" }}>
                {t("setup.title")}
              </p>
              <span className="text-12 shrink-0" style={{ color: "var(--text-tertiary)" }} data-testid="setup-progress">
                {ready ? `${doneCount}/${total}` : "–"}
              </span>
            </div>

            {!ready ? (
              <Skeleton className="h-4 w-3/4 mt-1.5" />
            ) : (
              <p className="text-13 mt-0.5 leading-snug" style={{ color: "var(--text-secondary)" }}>
                {body}
              </p>
            )}

            <div className="mt-2.5 h-1 rounded-full overflow-hidden" style={{ background: "var(--divider)" }}>
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{ width: `${Math.round(progress * 100)}%`, background: "var(--brand)" }}
              />
            </div>

            {ready && action && (
              <button
                onClick={() => navigate(action.to)}
                className="mt-2.5 flex items-center gap-1 text-13 font-bold ds-pressable"
                style={{ color: "var(--brand)" }}
              >
                {action.label}
                <ChevronRight
                  size={14}
                  strokeWidth={2.5}
                  style={{ transform: isRtl ? "rotate(180deg)" : undefined }}
                />
              </button>
            )}
          </div>
        </div>
      </ListCard>
    </div>
  );
}
