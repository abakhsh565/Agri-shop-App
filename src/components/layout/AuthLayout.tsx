import { type ReactNode } from "react";
import StatusBar from "@/components/ui/StatusBar";
import AuthLanguageSwitch from "@/components/auth/AuthLanguageSwitch";
import BackButtonHandler from "@/components/ui/BackButtonHandler";
import ToastContainer from "@/components/ui/Toast";

interface AuthLayoutProps {
  children: ReactNode;
}

/**
 * The shell every signed-out screen shares.
 *
 * It carries the language switch for all of them, in one place: sign-in, the code screen, the
 * PIN screens and the new-account screen are exactly the moments where someone who cannot read
 * the screen has no way to change it — the language row is inside Settings, behind the door
 * they are still trying to open. One control here covers every auth screen and cannot be
 * forgotten on a new one.
 *
 * The row itself is a full-width layout row (`w-full`), so the switch is positioned by the row's
 * own inset instead of by whatever width the flex parent happened to resolve to. Its left padding
 * matches the content gutter beneath it (`ps-6`), and the right inset is `pe-5` — the same gutter
 * the design already uses on the other edge, so the pill sits in the corner the way every other
 * corner control does rather than floating inwards.
 *
 * The row is pinned to the **right** edge in both languages, and `dir="ltr"` is what keeps it
 * there: `justify-end` means *inline* end, so in Urdu it would mirror to the left and the one
 * control that gets you out of a screen you cannot read would move every time you used it.
 * Setting the row's direction makes the logical utility resolve to the right edge for real,
 * without writing a physical utility (the source guard forbids those). The switch restores its
 * own direction from the language store, so the globe and label still order correctly in Urdu.
 */
export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="flex flex-col bg-background min-h-full w-full">
      <StatusBar />
      <div dir="ltr" className="flex w-full justify-end ps-6 pe-5 pt-3">
        <AuthLanguageSwitch />
      </div>
      <div className="flex flex-col flex-1 w-full">
        {children}
      </div>
      {/*
        The signed-out shell needs both of these as much as the signed-in ones do, and used
        to have neither: the back button closed the app on the first press (no listener), and
        the "press back again" notice had nowhere to appear (no toast host) — so the rule
        "two presses to leave" could not be shown on the one screen where a slipped thumb
        costs the most: mid-sign-in, with the phone number already typed.
      */}
      <BackButtonHandler />
      <ToastContainer />
    </div>
  );
}
