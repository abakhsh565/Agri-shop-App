import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.agrishop.app',
  appName: 'HisabPay',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // LIVE-STAGING SHELL (owner, 2026-11-21). A normal build leaves this unset: the WebView serves
    // the `dist/` bundle baked into the APK, so a design change needs a new APK. When
    // `CAP_SERVER_URL` is set at build time the WebView instead loads that origin, which means every
    // deploy of that origin appears in the installed app on its next open, with no rebuild.
    // It stays opt-in on purpose: a release APK must never be able to drift away from the code it
    // was signed for, so the URL cannot be set by anything but an explicit build-time variable.
    ...(process.env.CAP_SERVER_URL ? { url: process.env.CAP_SERVER_URL } : {}),
  },
};

export default config;
