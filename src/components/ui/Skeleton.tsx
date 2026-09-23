import type { CSSProperties } from "react";
import { useT } from "@/lib/i18n";
import ListCard from "@/components/ui/ListCard";

interface SkeletonProps {
  /** Any CSS width; defaults to a full line. */
  w?: string;
  h?: string;
  radius?: string;
  className?: string;
  style?: CSSProperties;
}

/** One grey shape standing in for content that has not arrived yet. */
export function Skeleton({ w = "100%", h = "14px", radius, className = "", style }: SkeletonProps) {
  return (
    <span
      className={`ds-skeleton block ${className}`}
      style={{ width: w, height: h, ...(radius ? { borderRadius: radius } : null), ...style }}
    />
  );
}

interface SkeletonListProps {
  rows?: number;
  /** Leading tile, as in the rows these stand in for. */
  tile?: boolean;
  /**
   * Rows only, without the card wrapper — for a list that already sits inside a
   * card (the dashboards), so the placeholder never grows a second card.
   */
  bare?: boolean;
}

/**
 * The grouped list card, drawn in grey, at the real row height and with the card's
 * own full-width separators — so the list settles into place instead of jumping
 * from an empty screen to a full one.
 *
 * The translated "loading" copy stays in the DOM as `sr-only`: the sentence is
 * still there for a screen reader, it is just no longer the only thing a
 * sighted user sees while they wait.
 */
export function SkeletonList({ rows = 4, tile = true, bare = false }: SkeletonListProps) {
  const t = useT();

  const rowShapes = (
    <div aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (            <div key={i} className="ds-row">
          {tile && <span className="ds-skeleton ds-tile size-11" />}
          <div className="min-w-0 flex-1 flex flex-col gap-2">
            <Skeleton w="45%" h="15px" />
            <Skeleton w="25%" h="12px" />
          </div>
        </div>
      ))}
    </div>
  );

  // A card that already owns the surface just borrows the rows.
  if (bare) {
    return (
      <div aria-busy="true" role="status">
        <span className="sr-only">{t("common.loading")}</span>
        {rowShapes}
      </div>
    );
  }

  return (
    <div className="px-4" aria-busy="true" role="status">
      <span className="sr-only">{t("common.loading")}</span>
      {/* The card comes from the primitive, not from a copy of its class: a skeleton
          is only convincing while it stays the same shape as the real list. */}
      <ListCard>{rowShapes}</ListCard>
    </div>
  );
}

export default Skeleton;
