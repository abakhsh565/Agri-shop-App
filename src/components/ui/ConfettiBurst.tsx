import { useEffect, useState } from "react";

/**
 * A short burst of confetti, drawn with plain elements.
 *
 * Not a library: this is a handful of coloured chips on one transform keyframe, which means
 * no dependency, no canvas, and no work on the JS thread after the first paint. The pieces
 * are seeded once and never re-rendered, and the whole tree unmounts itself when the last
 * one has fallen so nothing is left animating behind the next screen.
 *
 * It is decoration, so it is allowed to be absent: reduced-motion users get nothing (the
 * keyframe hides it), and the page it decorates never depends on it being there.
 */

/** Matches the longest `--confetti-dur` plus its stagger, so it can clean itself up. */
const LIFETIME_MS = 3200;

interface Piece {
  left: number;
  delay: number;
  duration: number;
  drift: number;
  spin: number;
  color: string;
  width: number;
  height: number;
}

const COLORS = [
  "var(--brand)",
  "var(--warning)",
  "var(--text-primary)",
  "var(--brand-dark)",
  "var(--error)",
];

function makePieces(count: number): Piece[] {
  return Array.from({ length: count }, (_, i) => {
    // Deterministic spread with a little jitter: even coverage (so the burst never clumps
    // in one corner of a narrow phone) without needing a random seed to look right.
    const slot = (i + 0.5) / count;
    return {
      left: Math.min(99, Math.max(1, slot * 100 + (Math.random() * 10 - 5))),
      delay: Math.random() * 0.35,
      duration: 1.9 + Math.random() * 0.9,
      drift: Math.random() * 90 - 45,
      spin: 360 + Math.random() * 720,
      color: COLORS[i % COLORS.length],
      width: 6 + Math.round(Math.random() * 4),
      height: 9 + Math.round(Math.random() * 6),
    };
  });
}

export default function ConfettiBurst({ count = 26 }: { count?: number }) {
  const [alive, setAlive] = useState(true);
  // Built once: regenerating on a re-render would restart every piece mid-fall.
  const [pieces] = useState<Piece[]>(() => makePieces(count));

  useEffect(() => {
    const timer = setTimeout(() => setAlive(false), LIFETIME_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!alive) return null;

  return (
    /* `z-30` matters: without a stacking order the pieces paint behind the receipt card, so the
       fall was only visible in the narrow margins beside it — decoration nobody sees. Above the
       content, below the sheets (z-50), and still `pointer-events-none`. */
    <div className="absolute inset-x-0 top-0 h-0 overflow-visible pointer-events-none z-30" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="ds-confetti"
          style={{
            insetInlineStart: `${p.left}%`,
            width: p.width,
            height: p.height,
            background: p.color,
            ["--confetti-dur" as string]: `${p.duration}s`,
            ["--confetti-delay" as string]: `${p.delay}s`,
            ["--confetti-drift" as string]: `${p.drift}px`,
            ["--confetti-spin" as string]: `${p.spin}deg`,
          }}
        />
      ))}
    </div>
  );
}
