import { useId } from "react";

/**
 * The app's mark, drawn rather than dropped in.
 *
 * RESOURCES/logo-badge.svg IS THE SOURCE, and its geometry is copied here verbatim: one disc and
 * one glyph path. Holding the path (instead of an <img>) is what lets the glyph DRAW ITSELF —
 * the stroke runs round the shape, then the fill arrives — so the first screen shows the mark
 * being made rather than a picture fading in. About 1.6s in all, which is why the splash holds
 * that long instead of flashing past in 1.5s.
 *
 * The disc is filled with `var(--brand)`, so light and dark shells draw the same mark in the same
 * token, and `animated={false}` gives a still copy for places already busy (a reply avatar).
 *
 * The visual carries no meaning: it is aria-hidden, and the screen it sits on says in text whether
 * the app is opening or asking for a PIN.
 */
const GLYPH =
  "M371.3 496.285L488.7 304.215C492.773 297.552 487.977 289 480.168 289H346.957C342.775 289 339.061 291.587 337.487 295.462C316.957 345.994 260.762 436.158 166.929 487.744C156.727 493.353 160.882 515.5 172.525 515.5H329.983C337.832 515.5 342.622 524.129 338.47 530.79L218.53 723.21C214.379 729.871 219.168 738.5 227.017 738.5H361.125C364.481 738.5 367.614 736.816 369.465 734.017L511.035 519.983C512.886 517.184 516.019 515.5 519.375 515.5H626.825C634.6 515.5 639.401 523.985 635.396 530.651L519.604 723.349C515.599 730.015 520.4 738.5 528.175 738.5H660.827C665.353 738.5 669.278 735.473 670.704 731.177C687.138 681.655 742.485 603.148 822.189 553.567C832.576 547.105 825.769 511.5 813.536 511.5H676.488C668.541 511.5 663.769 502.678 668.118 496.027L793.382 304.473C797.731 297.822 792.959 289 785.012 289H644.819C641.493 289 638.386 290.653 636.527 293.41L492.473 507.09C490.614 509.847 487.507 511.5 484.181 511.5H379.832C372.023 511.5 367.227 502.948 371.3 496.285Z";

interface BrandLogoProps {
  /** Rendered box in px; the SVG scales from the 1028-unit source. */
  size?: number;
  /** Draw-in animation. Off for repeated, small copies. */
  animated?: boolean;
  className?: string;
}

export default function BrandLogo({ size = 112, animated = true, className = "" }: BrandLogoProps) {
  // Two logos on one screen would otherwise share gradient and clip ids, and the second would
  // borrow the first one's defs.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const clipId = `brand-clip-${uid}`;
  const sheenId = `brand-sheen-${uid}`;

  return (
    <svg
      viewBox="0 0 1028 1028"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      className={`ds-brand-logo${animated ? " is-animated" : ""}${className ? ` ${className}` : ""}`}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="514" cy="514" r="514" />
        </clipPath>
        <linearGradient id={sheenId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <circle className="ds-brand-disc" cx="514" cy="514" r="514" fill="var(--brand)" />
        {/* The sheen is a group so the CSS transform can slide it across without overwriting
            the rect's own rotation. */}
        <g className="ds-brand-sheen">
          <rect
            x="300"
            y="-260"
            width="200"
            height="1620"
            fill={`url(#${sheenId})`}
            transform="rotate(24 514 514)"
          />
        </g>
        <path
          className="ds-brand-glyph"
          d={GLYPH}
          fill="#FFFFFF"
          stroke="#FFFFFF"
          strokeWidth={10}
          strokeLinejoin="round"
          pathLength={1}
        />
      </g>
    </svg>
  );
}
