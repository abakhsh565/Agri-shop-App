import type { CapacitorConfig } from "@capacitor/cli";

// Capacitor packages the compiled web app in `dist/` into a real native
// Android/iOS app. `androidScheme: "https"` makes the WebView serve the app
// over an https:// origin so React Router history and Supabase auth behave
// exactly like the deployed web app.
const config: CapacitorConfig = {
  appId: "com.agrishop.app",
  appName: "AgriShop",
  webDir: "dist",
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: "#0a0a0a",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
    },
    StatusBar: {
      overlaysWebView: true,
      style: "DARK",
      backgroundColor: "#00000000",
    },
  },
};

export default config;
