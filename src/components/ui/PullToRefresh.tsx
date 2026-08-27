import { useState, useRef, useCallback, type ReactNode } from "react";

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: ReactNode;
}

/**
 * Pull-to-refresh wrapper — works with touch on mobile.
 * Shows a spinning indicator at the top when pulled down far enough.
 */
export default function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [offset, setOffset] = useState(0);
  const startY = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const THRESHOLD = 80;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const el = containerRef.current;
    if (!el || el.scrollTop > 0) return; // only pull when at top
    startY.current = e.touches[0].clientY;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (refreshing) return;
    const el = containerRef.current;
    if (!el || el.scrollTop > 0) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0) {
      setPulling(true);
      setOffset(Math.min(dy * 0.5, THRESHOLD * 1.5));
    }
  }, [refreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (offset >= THRESHOLD && !refreshing) {
      setRefreshing(true);
      setOffset(THRESHOLD);
      try {
        await onRefresh();
      } catch {}
      setRefreshing(false);
    }
    setPulling(false);
    setOffset(0);
  }, [offset, refreshing, onRefresh]);

  return (
    <div
      ref={containerRef}
      className="flex flex-col flex-1 overflow-y-auto"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull indicator */}
      <div
        className="flex items-center justify-center overflow-hidden transition-all shrink-0"
        style={{ height: offset > 0 ? offset : refreshing ? 40 : 0 }}
      >
        <div
          className={`w-5 h-5 border-2 rounded-full ${refreshing ? "animate-spin" : ""}`}
          style={{
            borderColor: "var(--brand)",
            borderTopColor: "transparent",
            transform: refreshing ? undefined : `rotate(${offset * 3}deg)`,
          }}
        />
      </div>
      {children}
    </div>
  );
}
