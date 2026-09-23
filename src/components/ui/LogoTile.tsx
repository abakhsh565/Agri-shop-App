interface LogoTileProps {
  /** Used for the initials fallback and the alt text. */
  name: string;
  /** A real logo when the record has one (e.g. companies.logo_url). */
  src?: string | null;
  size?: number;
  className?: string;
}

/**
 * The reference's leading tile: a rounded square holding the entity's mark.
 *
 * Measured off the board at 44pt with an ~11pt radius and a hairline ring.
 * When a record has no logo the tile falls back to its initials on the sunken
 * tone — the same shape and rhythm, without inventing a colour per supplier
 * (the board is achromatic apart from real brand marks).
 */
export default function LogoTile({ name, src, size = 44, className = "" }: LogoTileProps) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";

  return (
    <div
      className={`ds-tile ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        // A logo needs the page tone behind it so transparent marks read.
        background: src ? "var(--tone-page)" : "var(--tone-sunken)",
      }}
      aria-hidden={src ? undefined : true}
    >
      {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : initials}
    </div>
  );
}
