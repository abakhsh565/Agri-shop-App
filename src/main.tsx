import React from 'react'
import ReactDOM from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import App from './App'
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
