import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";

export type QuickAlertTone = "critical" | "warning" | "neutral";

export interface QuickAlertItem {
  id: string;
  tone: QuickAlertTone;
  icon: LucideIcon;
  title: string;
  body?: string;
  meta?: string;
  action?: string;
  priority: number;
  onPress: () => void;
}

interface QuickAlertsPanelProps {
  title: string;
  items: QuickAlertItem[];
  viewAllLabel?: string;
  onViewAll?: () => void;
}

const TONE: Record<
  QuickAlertTone,
  { icon: string; action: string; iconBg: string }
> = {
  critical: {
    icon: "var(--error)",
    action: "var(--error)",
    iconBg: "rgba(239, 68, 68, 0.13)",
  },
  warning: {
    icon: "var(--warning)",
    action: "var(--warning)",
    iconBg: "rgba(245, 158, 11, 0.15)",
  },
  neutral: {
    icon: "var(--text-secondary)",
    action: "var(--text-secondary)",
    iconBg: "var(--muted)",
  },
};

const CARD_CLASS =
  "relative flex w-full items-start gap-2.5 rounded-[22px] px-3 py-2.5 text-start transition-transform duration-150 active:scale-[0.995]";

const SCROLL_ANCHOR_HOLD_MS = 280;

interface ScrollAnchorHold {
  scroller: HTMLElement;
  previous: string;
  top: number;
  timer: number;
}

function releaseScrollAnchor(hold: ScrollAnchorHold | null) {
  if (!hold) return;
  window.clearTimeout(hold.timer);
  if (hold.previous) hold.scroller.style.setProperty("overflow-anchor", hold.previous);
  else hold.scroller.style.removeProperty("overflow-anchor");
}

/** The shell has more than one `overflow-y-auto` node; only the nearest one that is actually
 *  scrollable is the element whose scrollTop changes when content grows. */
function findScrollableAncestor(start: HTMLElement | null): HTMLElement | null {
  let node = start?.parentElement ?? null;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function AlertCard({
  item,
  open,
  preview,
}: {
  item: QuickAlertItem;
  open: boolean;
  preview: boolean;
}) {
  const Icon = item.icon;
  const tone = TONE[item.tone];
  const testId = preview ? "quick-alert-" + item.id + "-preview" : "quick-alert-" + item.id;

  return (
    <button
      type="button"
      onClick={item.onPress}
      tabIndex={preview || open ? 0 : -1}
      data-testid={testId}
      className={CARD_CLASS + (preview ? " relative z-10" : "")}
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--divider)",
        boxShadow: preview ? "0 8px 22px rgba(0, 0, 0, 0.18)" : "none",
      }}
    >
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-[14px]"
        style={{ background: tone.iconBg, color: tone.icon }}
      >
        <Icon size={19} strokeWidth={1.9} aria-hidden />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          <span
            className="min-w-0 flex-1 text-14 font-semibold leading-snug"
            style={{ color: "var(--text-primary)" }}
          >
            {item.title}
          </span>
          {!item.action && (
            <ChevronRight
              size={14}
              aria-hidden
              className="mt-0.5 shrink-0"
              style={{ color: "var(--text-tertiary)" }}
            />
          )}
        </span>

        {item.body && (
          <span
            className="mt-0.5 block text-12 leading-snug"
            style={{ color: "var(--text-secondary)" }}
          >
            {item.body}
          </span>
        )}

        {(item.meta || item.action) && (
          <span className="mt-1.5 flex items-center justify-between gap-3">
            <span
              className="min-w-0 truncate text-10 font-medium"
              style={{ color: tone.action }}
            >
              {item.meta}
            </span>
            {item.action && (
              <span
                className="shrink-0 text-11 font-semibold"
                style={{ color: tone.action }}
              >
                {item.action}
              </span>
            )}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * Home's triage card.
 *
 * Closed, the highest-priority alert sits on a three-card deck. Open, the deck becomes the
 * list itself: up to seven real alerts, each with one fact, its context and one action. More
 * than seven belongs in the Action Center, behind View all. The rows, order and destinations
 * are unchanged.
 */
export default function QuickAlertsPanel({
  title,
  items,
  viewAllLabel,
  onViewAll,
}: QuickAlertsPanelProps) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const anchorHold = useRef<ScrollAnchorHold | null>(null);

  useEffect(() => {
    return () => {
      releaseScrollAnchor(anchorHold.current);
      anchorHold.current = null;
    };
  }, []);

  // The browser can adjust scrollTop while the card's height changes; put it back before paint
  // as a fallback for engines that do not implement `overflow-anchor`.
  useLayoutEffect(() => {
    const hold = anchorHold.current;
    if (hold && hold.scroller.scrollTop !== hold.top) hold.scroller.scrollTop = hold.top;
  }, [open]);

  /**
   * The card grows in place. Chrome's scroll anchoring can otherwise decide the content below
   * the card is the stable thing and move the viewport when the card expands or collapses. Hold
   * the page's own scroll container still for the duration of the disclosure animation.
   */
  function holdScrollAnchor() {
    const scroller = findScrollableAncestor(toggleRef.current);
    if (!scroller) return;

    let hold = anchorHold.current;
    if (hold && hold.scroller !== scroller) {
      releaseScrollAnchor(hold);
      hold = null;
      anchorHold.current = null;
    }
    if (!hold) {
      hold = {
        scroller,
        previous: scroller.style.getPropertyValue("overflow-anchor"),
        top: scroller.scrollTop,
        timer: 0,
      };
      anchorHold.current = hold;
    }

    const active = hold;
    window.clearTimeout(active.timer);
    scroller.style.setProperty("overflow-anchor", "none");
    active.timer = window.setTimeout(() => {
      if (anchorHold.current !== active) return;
      releaseScrollAnchor(active);
      anchorHold.current = null;
    }, SCROLL_ANCHOR_HOLD_MS);
  }

  if (items.length === 0) return null;

  const deck = items.slice(0, 7);

  return (
    <section className="px-4 pt-2" data-testid="quick-alerts">
      <div
        className="rounded-[28px] p-3"
        style={{ background: "var(--surface)" }}
      >
        <button
          ref={toggleRef}
          type="button"
          onClick={() => {
            holdScrollAnchor();
            setOpen((value) => !value);
          }}
          aria-expanded={open}
          aria-controls="quick-alerts-body"
          data-testid="quick-alerts-toggle"
          className="flex min-h-[44px] w-full items-center justify-between gap-3 px-1 text-start"
        >
          <p
            className="text-11 font-semibold uppercase tracking-[0.08em]"
            style={{ color: "var(--text-secondary)" }}
          >
            {title}
          </p>
          <ChevronDown
            size={18}
            aria-hidden
            className="shrink-0 transition-transform duration-200"
            style={{
              color: "var(--text-secondary)",
              transform: open ? "rotate(180deg)" : undefined,
            }}
          />
        </button>

        <div
          className={"ds-quick-alerts-deck" + (open ? " is-collapsed" : "")}
          aria-hidden={open}
          inert={open}
        >
          <div className="min-h-0">
            <div className="relative mt-1 pb-4">
              <span
                aria-hidden
                className="absolute inset-x-6 bottom-0 h-10 rounded-b-[24px]"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--divider)",
                  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.16)",
                  opacity: 0.55,
                }}
              />
              <span
                aria-hidden
                className="absolute inset-x-3 bottom-2 h-10 rounded-b-[24px]"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--divider)",
                  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.16)",
                  opacity: 0.82,
                }}
              />
              <AlertCard item={deck[0]} open={false} preview />
            </div>
          </div>
        </div>

        <div
          id="quick-alerts-body"
          className={"ds-quick-alerts-list" + (open ? " is-expanded" : "")}
          aria-hidden={!open}
          inert={!open}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="flex flex-col gap-1.5 pt-1.5">
              {deck.map((item) => (
                <AlertCard
                  key={item.id}
                  item={item}
                  open={open}
                  preview={false}
                />
              ))}

              {viewAllLabel && onViewAll && (
                <button
                  type="button"
                  onClick={onViewAll}
                  tabIndex={open ? 0 : -1}
                  className="mt-1 flex min-h-[44px] w-full items-center justify-start gap-1 ps-1 text-12 font-semibold"
                  style={{ color: "var(--brand)" }}
                >
                  {viewAllLabel}
                  <ChevronRight size={12} aria-hidden />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
