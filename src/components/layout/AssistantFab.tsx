import { Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useT } from "@/lib/i18n";
import { clearNav } from "@/lib/navContext";

/**
 * The assistant, within thumb reach of home instead of one tab along from it.
 *
 * WHY IT LEFT THE TAB BAR. A tab bar is for places you go to LOOK; the assistant is somewhere
 * you go to ASK, and it is asked for from wherever you already are rather than from a place of
 * its own. Carried as a tab it also spent a fifth of the bar's width on a screen with no list,
 * no count and nothing to come back to — and still asked for two taps from home, on the tab
 * that is easiest to hit in the wrong direction by accident.
 *
 * WHY IT IS ON THE HOME SCREEN ONLY. A button that follows you everywhere is a button you learn
 * to ignore. Home is where a question starts, the bar under it already answers "where am I",
 * and one screen with room to carry it is worth more than five screens each with a small copy.
 *
 * WHERE IT SITS. Bottom right for everyone, clear of the tab bar, inside the same 480px column
 * the bar is centred in — so on a wide window it lines up with the bar's own edge instead of
 * drifting to the far side of a monitor. The row is explicitly LTR: translating the rest of the
 * page must not move the launcher to the opposite corner from where it sits in English.
 *
 * TWO THINGS IT MUST KEEP. A name a screen reader can read, and a target 44px or wider: the
 * accessibility lane freezes both of those counts at zero (`tests/e2e/accessibility.spec.ts`),
 * so a circular icon button that cannot be spoken or thumbed fails the lane rather than the
 * person using it.
 */
export default function AssistantFab({ path }: { path: string }) {
  const t = useT();
  const navigate = useNavigate();

  return (
    /* The row is a full-width, click-through frame; only the button takes the finger. A fixed
       element stretched across the screen would otherwise swallow taps meant for the page
       underneath it, which is the one side effect a floating button can have that the page
       itself never can. */
    <div
      className="fixed pointer-events-none z-40"
      style={{ insetInlineStart: 0, insetInlineEnd: 0, bottom: "calc(var(--tabbar-height) + 16px)" }}
    >
      <div className="mx-auto max-w-[480px] px-4 flex justify-end" dir="ltr">
        <button
          type="button"
          onClick={() => { clearNav(); navigate(path); }}
          aria-label={t("nav.assistant")}
          data-testid="assistant-fab"
          className="pointer-events-auto flex items-center justify-center rounded-full ds-pressable"
          style={{
            width: 56,
            height: 56,
            background: "var(--brand)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.22)",
          }}
        >
          <Sparkles size={26} strokeWidth={2.5} color="#0a0a0a" />
        </button>
      </div>
    </div>
  );
}
