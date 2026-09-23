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
  /** Grey text shown inline after the name, as on the reference board. */
  qualifier?: string;
  /** Small tertiary line under the name. */
  meta?: string;
  description?: string;
  /** Right-aligned secondary value (e.g. "Auto", a date). */
  value?: string;
  /** Trailing slot: a state label, a pill, a check, a switch. */
  trailing?: ReactNode;
  /** The reference sets the name semibold in picking rows. */
  emphasis?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
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
 * Row height, padding, type and the hairline inset all come from the design
 * language tokens, so a screen adopts the look by using this component rather
 * than restating spacing by hand.
 */
export default function ListRow({
  icon: Icon,
  tile,
  title,
  children,
  qualifier,
  meta,
  description,
  value,
  trailing,
  emphasis = false,
  selected = false,
  disabled = false,
  onClick,
  className = "",
  style: extraStyle,
}: ListRowProps) {
  // The separator starts after the leading slot: 16 gutter + tile + 12 gap.
  const rowInset = tile ? 72 : Icon ? 52 : 16;
  const stacked = Boolean(description || meta || children);

  const inner = (
    <>
      {tile}
      {/* Sized from `--icon` via `ds-glyph`, so the whole app's row glyphs follow one token
          rather than a `size` prop restated in every primitive. */}
      {!tile && Icon && (
        <Icon size={24} style={{ color: "var(--text-secondary)" }} className="ds-glyph shrink-0" />
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
            {qualifier && <span className="ds-row-qualifier shrink-0 ms-1">{qualifier}</span>}
          </div>
          {meta && <p className="ds-row-meta truncate">{meta}</p>}
          {description && <p className="ds-row-desc mt-1">{description}</p>}
        </div>
      )}
      {value && <span className="ds-row-value shrink-0">{value}</span>}
      {trailing}
    </>
  );

  const cls = `ds-row ${stacked ? "ds-row-top" : ""} ${className}`;
  const style = { ...extraStyle, ["--row-inset" as string]: `${rowInset}px` } as React.CSSProperties;

  if (!onClick) {
    return (
      <div className={cls} style={style}>
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
      style={style}
    >
      {inner}
    </button>
  );
}
