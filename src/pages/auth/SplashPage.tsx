import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { canOpenWithPin } from "@/lib/pinLock";
import { getUserFromSession } from "@/lib/auth";
import { hasPin as hasPinMarker } from "@/lib/pinLock";
import { pinAllowedOnThisDevice, rememberLastProfile } from "@/lib/loginWindow";
import { entryDoor } from "@/lib/entryDoor";
import StatusBar from "@/components/ui/StatusBar";
import { APP_NAME } from "@/lib/brand";
import { useT } from "@/lib/i18n";
import { hasSeenIntro } from "@/education/introSeen";

export default function SplashPage() {
  const t = useT();
  const { user } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(async () => {
      if (user && user.isActive) {
        // Re-fetch latest user data from DB so admin-made changes (name, photo, etc.) are reflected
        const freshUser = await getUserFromSession();
        const latestUser = freshUser ?? user;
        // Always update local store — membership fields (tenantId, role, etc.)
        // may have changed since last save and must be persisted.
        if (freshUser) {
          useAuthStore.getState().setUser(freshUser);
        }
        // Keep the device's memory of this account in step with what it looks like now: the
        // keypad greets the person by name, and after an edit (or an admin renaming them) that
        // name comes from here.
        await rememberLastProfile(latestUser);
        // The PIN stands in for the number for a month. Past that the number itself is
        // confirmed again: a phone left in a drawer is not evidence of who is holding it, and
        // this is the one moment the app can still tell — before a PIN has been accepted.
        if (!(await pinAllowedOnThisDevice(latestUser.id))) {
          navigate("/login", { replace: true, state: { reverify: true } });
          return;
        }
        // The keypad is only drawn when it can actually answer: either the server can be
        // asked, or this device holds its own copy of the check. Showing it otherwise is what
        // used to bounce the owner through "forget the PIN" on every offline launch.
        if (await canOpenWithPin(latestUser.id)) {
          navigate("/login/pin", { replace: true, state: { user: latestUser } });
        } else if (hasPinMarker(latestUser.id)) {
          // A PIN was set on this device, but there is no way to check it here and no server
          // to ask. Say so on the sign-in screen instead of drawing an unusable keypad.
          navigate("/login", { replace: true });
        } else {
          // No PIN set → prompt to create one (mandatory for all users)
          const dest = (latestUser.role === "admin")
            ? "/admin/dashboard"
            : "/employee/dashboard";
          navigate("/login/pin-set", { replace: true, state: { returnTo: dest } });
        }
      } else {
        // Nobody is signed in on this device — but it may still know the account it last
        // served. That is the returning case the rule is about: after signing out, or after the
        // app was closed, the door is the PIN, not another code. The decision is made in one
        // place (`lib/entryDoor.ts`) and shared with sign-out, so both draw the same door.
        const door = await entryDoor();
        if (door.door === "pin") {
          const remembered = door.user;
          // Put the remembered profile back in the store first: the PIN screen reads the
          // greeting from it, and the app is entered as this account, not as "someone".
          useAuthStore.getState().setUser(remembered);
          navigate("/login/pin", { replace: true, state: { user: remembered } });
          return;
        }
        // A device that has never met the app gets the three introduction screens once; after
        // that it goes straight to sign-in, so a shop using the app for months never sees them
        // again.
        navigate(hasSeenIntro() ? "/login" : "/welcome", { replace: true });
      }
    }, 1500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex flex-col bg-background min-h-full w-full justify-between">
      <StatusBar />
      <div className="flex flex-col items-center justify-center gap-6 py-[120px] flex-1">
        {/* The badge is the launcher icon's own artwork — brand-lime circle, mark in ink — so
            the first screen and the phone's home screen show one identity. It is an image
            rather than themed shapes because `--ink` becomes the brand colour in dark mode,
            which drew a lime glyph on a lime tile. */}
        <img src="/icon-192.png" alt="" className="w-20 h-20" />
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-32 font-bold text-foreground">{APP_NAME}</p>
          <p className="text-sm text-caption">{t("auth.tagline")}</p>
        </div>
      </div>
    </div>
  );
}
