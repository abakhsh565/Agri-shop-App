# Building the AgriShop mobile app (APK for Android, project for iOS)

AgriShop is packaged with **Capacitor**. Capacitor takes the compiled web app
(the `dist/` folder produced by `pnpm run build`) and wraps it in a real native
Android / iOS project. The Android project compiles to an installable `.apk`
file — the same kind of file you download and install on a phone.

You run these steps on your **own computer** (where Android Studio is installed),
not inside Figma Make. The repo already carries the Capacitor config; the native
`android/` and `ios/` folders are generated fresh on your machine.

---

## One-time prerequisites
- **Android Studio** installed (it bundles the Android SDK + a JDK).
- **Node 22** and **pnpm** (`npm install -g pnpm`).
- The AgriShop repo cloned/downloaded to your computer.

---

## Build the Android APK

```bash
pnpm install            # install dependencies (first time / after pulling changes)
pnpm run build          # compile the web app into dist/
npx cap add android     # FIRST TIME ONLY — creates the android/ native project
npx cap sync android    # copy dist/ + plugins into the native project
npx cap open android    # open the project in Android Studio
```

Then in **Android Studio**:

- **Option 1 — install straight to a connected phone:** turn on *USB debugging*
  on the phone, plug it in, and press **Run ▶**. The app installs and launches.
- **Option 2 — get an APK file to share/install manually:**
  **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
  The file is created at:
  `android/app/build/outputs/apk/debug/app-debug.apk`
  Copy that `.apk` to the phone and open it to install (you'll be asked to allow
  "Install unknown apps" for your file manager the first time).

### After you change the app
Whenever the web code changes, re-run:

```bash
pnpm run build && npx cap sync android
```

then rebuild in Android Studio. (Shortcut: `pnpm run cap:sync`.)

### Making a proper shareable release APK (later)
The debug APK above is fine for testing. For a signed release build:
**Build → Generate Signed Bundle / APK**, create a keystore, and pick **APK**.
Keep the keystore file safe — you need the same one for every future update.

---

## Build for iPhone (needs a Mac + Xcode)

```bash
pnpm run build
npx cap add ios         # FIRST TIME ONLY
npx cap sync ios
npx cap open ios        # opens Xcode
```

In Xcode, pick a simulator or your connected iPhone and press **Run ▶**.
Installing on a physical iPhone requires a free Apple ID for local testing;
distributing to others requires a paid Apple Developer account.

---

## Notes
- **App identity:** `appId = com.agrishop.app`, `appName = AgriShop`
  (set in `capacitor.config.ts`).
- The app still talks to Supabase over the internet, so the phone needs a
  network connection for login and data — the *app itself* is installed locally.
- The service worker is automatically disabled inside the native app (it's only
  used for the browser PWA), so you won't get stale-cache problems on device.
