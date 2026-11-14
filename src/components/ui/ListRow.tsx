import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export interface ListRowProps {
  /** Leading icon when the row has no tile. */
  icon?: LucideIcon;
  /** Leading logo/avatar tile (takes precedence over `icon`). */
  tile?: ReactNode;
  /** The row's label. Optional when `children` supplies the row's own content. */
  title?: string;
  /**
   * Custom row content, for a row richer than `title`/`meta`/`value` (a badge
   * cluster, a two-line name block). The primitive still owns the row skeleton —
   * height, padding, the separator inset and the press state — so no screen has
   * to restate that by hand to have richer content.
   */
  children?: ReactNode;
  /**
   * A mark that belongs to the name itself (a Main/Sub chip), drawn inline on the title line.
   * Unlike `children`, it does not restack the row: the label and its mark stay one line.
   */
  badge?: ReactNode;
  /** Grey text shown inline after the name, as on the reference board. */
  qualifier?: string;
  /** Small tertiary line under the name. */
  meta?: ReactNode;
  description?: string;
  /** Right-aligned secondary value (e.g. "Auto", a date). */
  value?: string;
  /** Trailing slot: a state label, a pill, a check, a switch. */
  trailing?: ReactNode;
  /** The reference sets the name semibold in picking rows. */
  emphasis?: boolean;
  /** The one destructive row in a list (sign out): the label and its glyph go red. */
  danger?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  /**
   * Stable anchor for the guided tour, rendered as `data-tour`. Additive: it
   * changes nothing about how the row looks or behaves, and it is the only reason
   * the education system can point at a real row instead of a coordinate.
   */
  anchor?: string;
  /**
   * Stable handle for the test lanes, rendered as `data-testid`. The row does not
   * forward arbitrary props, so a lane that needs to address *this* row needs it named
   * — the alternative was clicking by translated copy, which breaks the moment the copy
   * is written better.
   */
  testId?: string;
  className?: string;
  /** Extra inline style (e.g. an accent row's tint); the row still owns the inset. */
  style?: React.CSSProperties;
}

/**
 * One row of the reference's list grammar:
 *   [tile | icon] name  qualifier … value [trailing]
 *                  meta
 *                  description
 *
 * Row height, padding, type and the gap between the name and its second line all
 * come from the design language tokens, so a screen adopts the look by using this
 * component rather than restating spacing by hand.
 */
export default function ListRow({
  icon: Icon,
  tile,
  title,
  children,
  badge,
  qualifier,
  meta,
  description,
  value,
  trailing,
  emphasis = false,
  danger = false,
  selected = false,
  disabled = false,
  onClick,
  anchor,
  testId,
  className = "",
  style: extraStyle,
}: ListRowProps) {
  // A stacked row is taller and top-aligned; the separator is full-bleed and owned by
  // the card, so the row no longer measures its leading slot to place a line.
  const stacked = Boolean(description || meta || children);

  const inner = (
    <>
      {tile}
      {/* Sized from `--icon-row` via `ds-row-glyph`, so every row glyph in the app follows
          one token rather than a `size` prop restated in every primitive — and so a row on
          More and a row on Settings are the same size by construction. */}
      {!tile && Icon && (
        <Icon
          size={18}
          style={{ color: danger ? "var(--error)" : "var(--text-secondary)" }}
          className="ds-row-glyph shrink-0"
        />
      )}
      {children ? (
        <div className="min-w-0 flex-1">{children}</div>
      ) : (
        <div className="min-w-0 flex-1">
          {/* A flex line, not an inline span: `truncate` needs a block-level box, and
              as a flex item the name gets one, so a long supplier name ellipsizes
              instead of being clipped mid-word. */}
          <div className={`flex items-baseline min-w-0 ${emphasis ? "ds-row-strong" : "ds-row-label"}`}>
            <span className="truncate min-w-0">{title}</span>
            {badge && <span className="shrink-0 ms-1.5 flex items-center">{badge}</span>}
            {qualifier && <span className="ds-row-qualifier shrink-0 ms-1">{qualifier}</span>}
          </div>
          {meta && <p className="ds-row-meta truncate">{meta}</p>}
          {description && <p className="ds-row-desc">{description}</p>}
        </div>
      )}
      {value && <span className="ds-row-value shrink-0">{value}</span>}
      {trailing}
    </>
  );

  const cls = `ds-row ${stacked ? "ds-row-top" : ""} ${danger ? "ds-row-danger" : ""} ${className}`;

  if (!onClick) {
    return (
      <div className={cls} style={extraStyle} data-tour={anchor} data-testid={testId}>
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-selected={selected || undefined}
      className={cls}
      style={extraStyle}
      data-tour={anchor}
      data-testid={testId}
    >
      {inner}
    </button>
  );
}
