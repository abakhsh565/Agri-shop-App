import { useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useEducationStore } from "@/stores/educationStore";
import WelcomeSheet from "@/components/education/WelcomeSheet";
import TourOverlay from "@/components/education/TourOverlay";

/**
 * Where the education system meets the shell.
 *
 * Mounted once by each layout, so the tour survives navigation inside that shell
 * (its steps live on several screens) and never has to exist outside a signed-in
 * app. It does exactly three things:
 *
 *  1. Points the education store at the signed-in account, so the flags belong to
 *     a person rather than to whoever used the phone last.
 *  2. On the **first** signed-in session — `user.firstLoginAt` is null for exactly
 *     that session, written server-side by the login path — offers the welcome
 *     once, if this device has not already shown it. It is a sheet over the
 *     screen the owner already landed on, never a redirect.
 *  3. Renders the sheet and the tour overlay.
 *
 * It reads nothing from the setup-completion system and writes nothing to it: a
 * shop that has been configured to the last supplier still gets the tour, and a
 * shop with nothing set up yet can dismiss the welcome and go straight to work.
 */
export default function FirstRunGate() {
  const user = useAuthStore((s) => s.user);
  const sync = useEducationStore((s) => s.sync);
  const openWelcome = useEducationStore((s) => s.openWelcome);

  const uid = user?.id ?? null;
  const firstLoginAt = user?.firstLoginAt ?? null;

  // Account switched (a shop phone with two logins): load that person's record.
  useEffect(() => {
    sync(uid);
  }, [uid, sync]);

  useEffect(() => {
    if (!uid) return;
    if (firstLoginAt) return; // has signed in before → not a new owner
    const { welcomeSeen, welcomeOpen, tourOpen } = useEducationStore.getState();
    if (welcomeSeen || welcomeOpen || tourOpen) return;
    openWelcome();
  }, [uid, firstLoginAt, openWelcome]);

  return (
    <>
      <WelcomeSheet />
      <TourOverlay />
    </>
  );
}
