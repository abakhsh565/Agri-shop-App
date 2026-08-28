/**
 * Safe-area spacer for the top of every screen.
 *
 * On a real device (installed APK / iOS home-screen PWA) this reserves the
 * height of the OS status bar / notch via `env(safe-area-inset-top)`, so app
 * content never sits underneath the real system clock and icons — the OS draws
 * the genuine status bar in this region. On the desktop preview the inset is
 * 0, so a small consistent top gap is kept for visual rhythm.
 */
export default function StatusBar() {
  return (
    <div
      className="shrink-0 w-full"
      style={{ height: "max(var(--safe-top), 8px)" }}
    />
  );
}
