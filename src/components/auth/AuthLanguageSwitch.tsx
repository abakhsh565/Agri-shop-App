import { Globe } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";

/**
 * Language control for the signed-out screens.
 *
 * The language row lives inside Settings — behind the sign-in door — so a shopkeeper whose
 * phone is in Urdu could be stuck reading an English sign-in screen with no way out of it.
 * This is the same setting, reachable from where it is first needed.
 *
 * It shows the language you would switch **to**, not the one you are in: a button that says
 * "اردو" is an offer, where a button saying "English" reads like a status. Toggling is
 * one tap — there are only two languages, so a picker sheet would be a menu with one choice.
 * `applyDirection` flips the whole document. This pill is the deliberate exception to that flip:
 * it is pinned to the physical right on every auth screen (see `AuthLayout`), so it takes its own
 * direction from the language store rather than inheriting the wrapper's — otherwise Urdu would
 * order the globe and label as English inside a right-aligned button.
 */
export default function AuthLanguageSwitch() {
  const t = useT();
  const language = useThemeStore((s) => s.language);
  const setLanguage = useThemeStore((s) => s.setLanguage);

  const next = language === "en" ? "ur" : "en";

  return (
    <button
      type="button"
      dir={language === "ur" ? "rtl" : "ltr"}
      onClick={() => setLanguage(next)}
      aria-label={t("auth.switchLanguage")}
      data-testid="auth-language"
      className="ds-pressable flex items-center gap-1.5 h-8 px-3 rounded-full text-12 font-semibold shrink-0"
      style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
    >
      <Globe size={14} style={{ color: "var(--text-secondary)" }} />
      {/* `dir="auto"` so the Latin and Urdu names each render in their own direction while the
          button stays put in the layout. */}
      <span dir="auto">{next === "ur" ? "اردو" : "English"}</span>
    </button>
  );
}
