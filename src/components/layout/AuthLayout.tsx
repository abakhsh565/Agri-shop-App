import { type ReactNode } from "react";
import StatusBar from "@/components/ui/StatusBar";
import AuthLanguageSwitch from "@/components/auth/AuthLanguageSwitch";

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
 * It sits on the same 24px gutter (`px-6`) as the content beneath it, so it reads as part of the
 * page rather than floating 8px off the edge of everything else on it.
 */
export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="flex flex-col bg-background min-h-full w-full">
      <StatusBar />
      <div className="flex justify-end px-6 pt-3">
        <AuthLanguageSwitch />
      </div>
      <div className="flex flex-col flex-1 w-full">
        {children}
      </div>
    </div>
  );
}
