import { useT } from "@/lib/i18n";
import Sheet from "@/components/ui/Sheet";
import { useEducationStore } from "@/stores/educationStore";

/**
 * The first-run introduction: one sheet, three lines, two ways out.
 *
 * It deliberately does **not** redirect anyone and does not stand between the
 * owner and the app. "Show me around" starts the tour on the screen the owner is
 * already standing on; "Later" (and the sheet's own X, and Escape, and a backdrop
 * tap) simply dismiss the sheet and leave the app exactly as it was found. Both
 * exits are recorded, so a person who closed it is not asked again.
 *
 * Whether it appears at all is decided by the shell, which owns the two facts it
 * needs: this account has never signed in before (`user.firstLoginAt` is null)
 * and this device has not already dismissed it.
 */
export default function WelcomeSheet() {
  const t = useT();
  const { welcomeOpen, dismissWelcome, startTour } = useEducationStore();

  return (
    /* Both answers to this sheet are buttons inside it, so the header carries no third one. */
    <Sheet open={welcomeOpen} title={t("edu.welcome.title")} onClose={dismissWelcome} closeButton={false}>
      <div className="px-5 pt-1">
        <p className="text-14" style={{ color: "var(--text-secondary)" }} data-testid="welcome-body">
          {t("edu.welcome.body")}
        </p>

        <button
          type="button"
          onClick={startTour}
          data-testid="welcome-tour"
          className="ds-btn-brand w-full h-11 mt-4 text-14 font-bold"
        >
          {t("edu.welcome.tour")}
        </button>

        <button
          type="button"
          onClick={dismissWelcome}
          data-testid="welcome-later"
          className="ds-pressable w-full h-11 mt-1 text-14 font-semibold"
          style={{ color: "var(--text-tertiary)" }}
        >
          {t("edu.welcome.later")}
        </button>
      </div>
    </Sheet>
  );
}
