import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { canOpenWithPin } from "@/lib/pinLock";
import { getUserFromSession } from "@/lib/auth";
import { hasPin as hasPinMarker } from "@/lib/pinLock";
import { pinAllowedOnThisDevice, rememberLastProfile } from "@/lib/loginWindow";
import { entryDoor } from "@/lib/entryDoor";
import StatusBar from "@/components/ui/StatusBar";
import BrandLogo from "@/components/brand/BrandLogo";
import { APP_NAME } from "@/lib/brand";
import { useT } from "@/lib/i18n";
import { hasSeenIntro } from "@/education/introSeen";
import { homePathForUser } from "@/lib/experience";

export default function SplashPage() {
  const t = useT();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const stageRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  const [leaving, setLeaving] = useState(false);

  /**
   * Hands the screen over by flying INTO the mark: the stage grows from the glyph's own centre and
   * fades, so the next screen arrives out of the logo rather than cutting in behind it. The
   * navigation still happens on a timer, so a reduced-motion device (or a browser that never runs
   * the transition) lands on the same screen at the same moment.
   */
  const leave = useCallback(
    (to: string, options?: { replace?: boolean; state?: unknown }) => {
      const stage = stageRef.current;
      const mark = markRef.current;
      const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!stage || !mark || calm) {
        navigate(to, options);
        return;
      }
      const box = stage.getBoundingClientRect();
      const glyph = mark.getBoundingClientRect();
      stage.style.transformOrigin = `${glyph.left + glyph.width / 2 - box.left}px ${
        glyph.top + glyph.height / 2 - box.top
      }px`;
      setLeaving(true);
      window.setTimeout(() => navigate(to, options), 260);
    },
    [navigate],
  );

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
          leave("/login", { replace: true, state: { reverify: true } });
          return;
        }
        // The keypad is only drawn when it can actually answer: either the server can be
        // asked, or this device holds its own copy of the check. Showing it otherwise is what
        // used to bounce the owner through "forget the PIN" on every offline launch.
        if (await canOpenWithPin(latestUser.id)) {
          leave("/login/pin", { replace: true, state: { user: latestUser } });
        } else if (hasPinMarker(latestUser.id)) {
          // A PIN was set on this device, but there is no way to check it here and no server
          // to ask. Say so on the sign-in screen instead of drawing an unusable keypad.
          leave("/login", { replace: true });
        } else {
          // No PIN set → prompt to create one (mandatory for all users)
          const dest = homePathForUser(latestUser);
          leave("/login/pin-set", { replace: true, state: { returnTo: dest } });
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
          leave("/login/pin", { replace: true, state: { user: remembered } });
          return;
        }
        // A device that has never met the app gets the three introduction screens once; after
        // that it goes straight to sign-in, so a shop using the app for months never sees them
        // again.
        leave(hasSeenIntro() ? "/login" : "/welcome", { replace: true });
      }
      // Long enough for the whole arrival to land: the glyph is written by ~1.0s, the name rises at
      // 1.05s and the line under it at 1.3s, so the screen is complete for a beat before it hands
      // over. A splash that leaves mid-animation is a flash, not a first screen.
    }, 2000);
    return () => clearTimeout(t);
  }, [leave, user]);

  return (
    <div
      ref={stageRef}
      className={`ds-splash-stage flex flex-col bg-background min-h-full w-full justify-between${
        leaving ? " is-leaving" : ""
      }`}
    >
      <StatusBar />
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-10">
        {/* The mark is the launcher icon's own artwork — a brand-lime disc with the glyph in
            white on a transparent canvas, so nothing draws a tile behind it — and the first
            screen and the phone's home screen show one identity. It is an image rather than
            themed shapes because `--ink` becomes the brand colour in dark mode, which drew a
            lime glyph on a lime tile. */}
        {/* The mark alone, in the brand colour: no disc behind it and nothing drawn around it.
            The glyph is written first, then the name, then the line under it. */}
        <span ref={markRef} className="ds-splash-mark" style={{ width: 112, height: 112 }}>
          <BrandLogo variant="mark" size={112} />
        </span>
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-32 font-bold text-foreground ds-splash-name">{APP_NAME}</p>
          <p className="text-sm text-caption ds-splash-tagline">{t("auth.tagline")}</p>
        </div>
      </div>
    </div>
  );
}
