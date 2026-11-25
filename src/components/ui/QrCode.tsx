import { useEffect, useState } from "react";

/**
 * A QR code as a plain image.
 *
 * WHY IT LOADS ITSELF. QR drawing is a few kilobytes of code that only two sheets ever need — the
 * shop's farmer code and one farmer's invite. Importing it at the top of the bundle would make
 * every screen pay for a picture it never shows, so the encoder is fetched when a code is actually
 * put on screen.
 *
 * It renders an `<img>` rather than injected SVG because the value is supplied by the server and
 * markup built from it is the one shape that can be read as anything but a picture.
 *
 * The value never leaves the phone: encoding happens locally, so a farmer's credential is not put
 * in a URL to somebody else's image service.
 */
export default function QrCode({
  value,
  size = 200,
  label,
}: {
  value: string;
  size?: number;
  label: string;
}) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let alive = true;
    setSrc("");
    void import("qrcode")
      .then(async (mod) => {
        // The package exposes `toDataURL` both as a named export and on its default object;
        // accept either so a bundler's interop choice cannot blank the code.
        const qr = mod as unknown as {
          toDataURL?: (text: string, options: Record<string, unknown>) => Promise<string>;
          default?: {
            toDataURL?: (text: string, options: Record<string, unknown>) => Promise<string>;
          };
        };
        const draw = qr.toDataURL ?? qr.default?.toDataURL;
        if (!draw) throw new Error("QR encoder unavailable");
        return draw(value, {
          margin: 1,
          width: size,
          errorCorrectionLevel: "M",
          color: { dark: "#000000", light: "#ffffff" },
        });
      })
      .then((url) => {
        if (alive) setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [value, size]);

  if (!src) {
    return (
      <div
        aria-hidden="true"
        style={{ width: size, height: size, background: "var(--muted)", borderRadius: 12 }}
      />
    );
  }

  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={label}
      style={{ borderRadius: 12, background: "#ffffff" }}
    />
  );
}
