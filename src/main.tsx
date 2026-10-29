import React from 'react'
import ReactDOM from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import App from './App'
import { captureError, initErrorReporting, resolveReleaseId } from './lib/errorReporting'
import './index.css'

const isNative = Capacitor.isNativePlatform();

// PWA install support only in a real (production) *web* build. On native
// (Capacitor APK/iOS) the app is bundled locally, so a caching service worker
// would only risk trapping the app on a stale bundle — skip it there. During
// Figma Make preview/dev we also actively unregister any existing worker.
if ("serviceWorker" in navigator && !isNative) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });

    // Manifest enables "Add to Home Screen" on Android/iOS.
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "/manifest.json";
    document.head.appendChild(link);
  } else {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    });
    if (window.caches) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
    }
  }
}

// On a real device, draw the WebView edge-to-edge behind the OS status bar so
// the safe-area insets already wired in index.css / StatusBar.tsx become real,
// then dismiss the native splash once React has mounted.
if (isNative) {
  void (async () => {
    try {
      const { StatusBar } = await import("@capacitor/status-bar");
      await StatusBar.setOverlaysWebView({ overlay: true });
      // Icon/content colour is theme-driven in themeStore.applyTheme(), which
      // runs on mount (App.tsx) and on every theme toggle.
    } catch {
      // status-bar plugin unavailable — safe to ignore
    }
    try {
      const { SplashScreen } = await import("@capacitor/splash-screen");
      await SplashScreen.hide();
    } catch {
      // splash-screen plugin unavailable — safe to ignore
    }
  })();
}

// Error visibility. Before this, a crash on an owner's phone left nothing behind anywhere.
//
// Two destinations, one handler. `client_error_events` is the private record (write-only, read by the
// service role); `src/lib/errorReporting.ts` is the notification channel that makes a broken release
// visible to the team. Both refuse to look like coverage when they are not configured, and both own
// their own allow-list — this handler filters nothing and decides nothing.
//
// It is registered before the first render, because the errors worth having include the ones that
// happen on the way in — including before sign-in, which is why the table accepts pre-login writes.
// The release id is resolved here, once, so the record and the alert name the same commit.
const releaseId = resolveReleaseId(import.meta.env as unknown as Record<string, unknown>);

void initErrorReporting();

function reportUncaught(error: unknown): void {
  void import('./lib/monitoring').then(({ reportClientError }) =>
    reportClientError({
      error,
      screen: window.location.pathname,
      ...(releaseId ? { appVersion: releaseId } : {}),
    }),
  );
  void captureError(error, { screen: window.location.pathname });
}

window.addEventListener('error', (event) => reportUncaught(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => reportUncaught(event.reason));

// A 48px field pill is mostly padding: the input inside it is only as tall as its text line, so a
// tap on the rest of the pill did nothing, and on a phone that reads as a dead control (the owner's
// report: "if I click in the centre then it gets active"). One delegated listener gives every
// screen the whole-pill target, instead of each form growing its own handler and the next form
// forgetting it. Buttons inside a field (a picker trigger, a clear mark) keep their own behaviour.
const FIELD_OWNERS = 'input, textarea, select, button, a, [role="button"], [role="switch"]';

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;
  if (!target || typeof target.closest !== 'function') return;
  const shell = target.closest('.ds-field');
  if (!shell || target.closest(FIELD_OWNERS)) return;
  const field = shell.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled])',
  );
  if (!field) return;
  event.preventDefault();
  field.focus({ preventScroll: true });
  // A tap after a value is already there should put the caret where the person tapped, which is
  // the end of what they typed — not select the whole value and make the next keystroke replace it.
  if (field instanceof HTMLInputElement && field.type !== 'number' && field.type !== 'date') {
    const end = field.value.length;
    field.setSelectionRange?.(end, end);
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
