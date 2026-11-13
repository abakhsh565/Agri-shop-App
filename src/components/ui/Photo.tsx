import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

/**
 * A picture that may not be there.
 *
 * Rows store a URL, not the file. A row whose object was never uploaded to this project (a URL
 * written against another one) or was later deleted still carries a URL that answers 404, and a
 * bare `<img>` then leaves the browser's broken-image glyph where the record's picture belongs —
 * which reads as "this record has a photo" when it has none. An error swaps in the very fallback
 * the screen already shows for an empty column, so a dead file looks exactly like a record that
 * never had a picture, and nothing has to guess why the two differ.
 */
export default function Photo({
  src,
  alt = "",
  className,
  style,
  fallback,
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  /** What this screen shows for a record with no picture: initials, an icon, an empty tile. */
  fallback: ReactNode;
}) {
  const [failed, setFailed] = useState(false);

  // A new URL is a new attempt: an upload replaces the old (dead) one, and the picture must appear.
  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) return <>{fallback}</>;

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      onError={() => setFailed(true)}
    />
  );
}
