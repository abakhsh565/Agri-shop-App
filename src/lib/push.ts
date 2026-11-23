import { Capacitor } from "@capacitor/core";
import { supabase } from "@/lib/supabase";

/**
 * The app's side of push notifications.
 *
 * WHY IT IS THIS SMALL. The decision about *who* should be told *what* is made in the database
 * (migration 0329): an event writes the same in-app notification it always did, and a trigger
 * queues a push for the people who can act on it. This file only hands the phone's own address
 * to that system and follows a tap back into the right screen. A client that decided recipients
 * would be a second authorization model, and the first one to drift.
 *
 * NATIVE ONLY. On the web the same notifications already arrive through Realtime and the
 * `notifications` table; a service worker push is a separate channel with its own keys, so this
 * deliberately does nothing there rather than half-working.
 *
 * ONE REGISTRATION PER LAUNCH. `register()` is idempotent at the OS level, and the device row is
 * upserted by token, so a reinstall moves the row instead of duplicating it. The guard below
 * stops React's development double-mount from attaching two listeners to one token.
 */
const CHANNEL_ID = "agrishop";

let started = false;

export async function startPushNotifications(
  navigate: (path: string) => void,
): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || started) return false;
  started = true;

  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");

    // Android 13+ asks at runtime. A refusal is a real answer: the app keeps working, and the
    // in-app feed is still complete, so nothing is blocked behind this permission.
    let permission = (await PushNotifications.checkPermissions()).receive;
    if (permission === "prompt" || permission === "prompt-with-rationale") {
      permission = (await PushNotifications.requestPermissions()).receive;
    }
    if (permission !== "granted") {
      started = false;
      return false;
    }

    // Android 8+ needs a channel or the notification is dropped silently, with no error.
    // iOS has no channels, and asking for one there is an error, not a no-op.
    if (Capacitor.getPlatform() === "android") {
      await PushNotifications.createChannel({
        id: CHANNEL_ID,
        name: "AgriShop",
        description: "Orders, messages and requests",
        importance: 5,
        visibility: 1,
        vibration: true,
      });
    }

    await PushNotifications.addListener("registration", (token) => {
      void supabase
        .rpc("register_push_device", {
          p_device_token: token.value,
          p_platform: Capacitor.getPlatform(),
        })
        .then(({ error }) => {
          if (error && import.meta.env.DEV) {
            console.warn("[push] device registration failed:", error.message);
          }
        });
    });

    await PushNotifications.addListener("registrationError", (error) => {
      if (import.meta.env.DEV) console.warn("[push] registration error:", error.error);
    });

    // A tap is the only moment a push is worth anything: it must land on the thing it named,
    // not on the home screen. The server sends a `route` the app already knows.
    await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      const route = action.notification.data?.route;
      if (typeof route === "string" && route.startsWith("/")) navigate(route);
    });

    // Arriving while the app is open: the OS banner is not shown, so refresh the in-app feed —
    // otherwise the bell and the list would trail the notification the person just saw.
    await PushNotifications.addListener("pushNotificationReceived", () => {
      void import("@/stores/notificationStore").then((module) =>
        module.useNotificationStore.getState().load(),
      );
    });

    await PushNotifications.register();
    return true;
  } catch {
    // No Google services (an emulator without them, a build without the config file): the app
    // remains fully usable, and the next launch retries.
    started = false;
    return false;
  }
}

/** True once this launch has asked the OS for a token (used by tests and diagnostics). */
export function pushStarted(): boolean {
  return started;
}
