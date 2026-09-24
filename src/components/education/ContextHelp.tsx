import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Check, CircleHelp, Play, Compass, MessageCircleQuestion } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useEducationStore } from "@/stores/educationStore";
import { helpForPath, tutorialById } from "@/education/model";
import TutorialSheet from "./TutorialSheet";
import AskQuestionSheet from "./AskQuestionSheet";

/**
 * Help where the person already is.
 *
 * The App guide answers "what can this app do"; this answers "what am I looking at", without
 * making anyone leave the job they were doing to go and read. It is one affordance mounted
 * once per shell, not a button added to every screen: the help is chosen from the route
 * (`helpForPath`), so a new screen either has an explanation in the model or shows no button
 * at all — never a generic page of filler.
 *
 * It stays out of the way in the two cases that matter: while the guided tour is running (the
 * tour is already teaching this same screen), and on screens the model does not describe.
 * Tapping it writes nothing — every action inside navigates or opens a sheet, and closing
 * leaves the screen exactly as it was.
 */
export default function ContextHelp() {
  const t = useT();
  const navigate = useNavigate();
  const base = useShellBase();
  const location = useLocation();
  const tourOpen = useEducationStore((s) => s.tourOpen);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tutorialId, setTutorialId] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);

  const relative = base && location.pathname.startsWith(base)
    ? location.pathname.slice(base.length)
    : location.pathname;
  const help = helpForPath(relative);
  if (!help || tourOpen) return null;

  const tutorial = tutorialById(help.tutorialId);

  return (
    <>
      <button
        type="button"
        onClick={() => setHelpOpen(true)}
        aria-label={t("edu.help.open")}
        data-testid="context-help"
        className="ds-iconbtn fixed z-20"
        style={{
          // Logical inset: the affordance sits on the leading edge's opposite side in both
          // directions without a per-language override.
          insetInlineEnd: 16,
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 84px)",
          background: "var(--tone-card)",
          borderRadius: "999px",
          // 44px, not the 36 an icon button usually gets: this sits in a corner a thumb
          // reaches while walking, and the accessibility floor for a touch target is 44.
          // It is what the audit measures, so it is the size that ships.
          width: 44,
          height: 44,
          boxShadow: "var(--shadow-sm, 0 1px 2px rgba(0,0,0,.08))",
        }}
      >
        <CircleHelp size={16} style={{ color: "var(--text-secondary)" }} />
      </button>

      {helpOpen && (
        <Sheet open title={t("edu.help.title")} onClose={() => setHelpOpen(false)}>
          <div className="px-5 pb-6" data-testid="context-help-sheet">
            <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
              {t("edu.help.what")}
            </p>
            <p className="text-15 mt-1 font-bold" style={{ color: "var(--text-primary)" }}>
              {t(help.titleKey)}
            </p>
            <p className="text-14 mt-1" style={{ color: "var(--text-secondary)" }} data-testid="context-help-what">
              {t(help.whatKey)}
            </p>

            <p className="ds-section-label mt-4 mb-2" style={{ color: "var(--text-secondary)" }}>
              {t("edu.help.look")}
            </p>
            <ListCard>
              {help.pointKeys.map((key) => (
                <ListRow
                  key={key}
                  tile={<Check size={14} style={{ color: "var(--brand-dark)" }} />}
                  title={t(key)}
                />
              ))}
            </ListCard>

            {tutorial && (
              <div className="mt-4">
                <ListCard>
                  <ListRow
                    icon={Play}
                    title={t("edu.tut.watch")}
                    meta={t(tutorial.titleKey)}
                    onClick={() => { setHelpOpen(false); setTutorialId(tutorial.id); }}
                    testId="context-help-watch"
                  />
                </ListCard>
              </div>
            )}

            <div className="mt-4">
              <ListCard>
                <ListRow
                  icon={Compass}
                  title={t("edu.help.guide")}
                  onClick={() => { setHelpOpen(false); navigate(`${base}/guide`); }}
                />
                <ListRow
                  icon={MessageCircleQuestion}
                  title={t("edu.help.ask")}
                  onClick={() => { setHelpOpen(false); setAskOpen(true); }}
                  testId="context-help-ask"
                />
              </ListCard>
            </div>
          </div>
        </Sheet>
      )}

      {tutorialId && <TutorialSheet tutorialId={tutorialId} onClose={() => setTutorialId(null)} />}
      {askOpen && <AskQuestionSheet onClose={() => setAskOpen(false)} />}
    </>
  );
}
