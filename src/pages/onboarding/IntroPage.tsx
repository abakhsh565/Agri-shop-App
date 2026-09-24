import { useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import { useT } from "@/lib/i18n";
import { INTRO_SLIDES } from "@/education/model";
import { markIntroSeen } from "@/education/introSeen";
import { useThemeStore } from "@/stores/themeStore";

/**
 * The three screens shown once, before anyone signs in.
 *
 * This is product introduction, not the guided tour: it says what the app is for
 * in three lines and gets out of the way. It owns no account state (there is no
 * account yet) — the device record in `introSeen` is the whole of its memory.
 *
 * Every exit marks it seen, including Skip, so a shop owner who is not interested
 * is never shown it again. Sliding is manual: swipe gestures are not part of this
 * design language, and a button is a bigger target than a swipe on a cheap phone.
 *
 * Each slide shows a **real screen of this app** rather than an illustration of one:
 * the pictures are captured from the running product by the media pipeline, in both
 * themes, so the person recognises the app they are about to open. The icon stays as
 * a small mark beside the title; it is no longer asked to stand in for the product.
 */
export default function IntroPage() {
  const t = useT();
  const navigate = useNavigate();
  const theme = useThemeStore((s) => s.theme);
  const [index, setIndex] = useState(0);

  const slide = INTRO_SLIDES[Math.min(index, INTRO_SLIDES.length - 1)];
  const isLast = index >= INTRO_SLIDES.length - 1;
  const Icon = slide.icon;
  const shot = theme === "dark" ? slide.image.dark : slide.image.light;

  const finish = () => {
    markIntroSeen();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex flex-col min-h-full w-full" style={{ background: "var(--background)" }}>
      <StatusBar />

      <div className="flex items-center justify-end px-4 pt-2">
        <button
          type="button"
          onClick={finish}
          data-testid="intro-skip"
          className="ds-pressable text-13 font-semibold px-2 py-2"
          style={{ color: "var(--text-tertiary)" }}
        >
          {t("edu.intro.skip")}
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <img
          src={shot}
          alt=""
          data-testid="intro-visual"
          className="block"
          style={{
            width: 236,
            aspectRatio: "390 / 520",
            objectFit: "cover",
            objectPosition: "top",
            borderRadius: "var(--radius-card)",
            border: "1px solid var(--divider)",
            background: "var(--tone-card)",
          }}
        />

        <div className="flex items-center gap-2 mt-5">
          <Icon size={16} strokeWidth={1.5} style={{ color: "var(--text-secondary)" }} />
          <p className="text-20 font-bold" style={{ color: "var(--text-primary)" }} data-testid="intro-title">
            {t(slide.titleKey)}
          </p>
        </div>
        <p className="text-14 mt-2 max-w-[300px]" style={{ color: "var(--text-secondary)" }} data-testid="intro-body">
          {t(slide.bodyKey)}
        </p>

        <div className="flex items-center gap-2 mt-6" data-testid="intro-dots">
          {INTRO_SLIDES.map((s, i) => (
            <span
              key={s.id}
              style={{
                width: i === index ? 18 : 6,
                height: 6,
                borderRadius: 999,
                background: i === index ? "var(--brand)" : "var(--divider)",
              }}
            />
          ))}
        </div>
      </div>

      <div className="px-6 pb-8">
        <button
          type="button"
          data-testid="intro-next"
          onClick={() => (isLast ? finish() : setIndex((i) => i + 1))}
          className="ds-btn-brand w-full h-12 text-15 font-bold"
        >
          {isLast ? t("edu.intro.start") : t("edu.intro.next")}
        </button>
      </div>
    </div>
  );
}
