import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Compass, MessageCircleQuestion, Play, X } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useDir } from "@/lib/dirContext";
import { useEducationStore } from "@/stores/educationStore";
import TutorialSheet from "@/components/education/TutorialSheet";
import AskQuestionSheet from "@/components/education/AskQuestionSheet";
import {
  FAQS,
  FEATURES,
  TUTORIALS,
  WORKFLOWS,
  currentEduRole,
  featureById,
  featurePath,
  guideForRole,
  isOwnerRole,
  visibleTourSteps,
} from "@/education/model";

/**
 * App guide — the permanent way back into the education system.
 *
 * Two halves, and they answer different questions:
 *
 *   • **Show me around** — the guided tour, which teaches *where things are* on the real UI.
 *   • **What this app does** — one line per capability: what it does, and why a shop keeps
 *     it. This half is why someone returns to this screen a month after onboarding, so it
 *     explains the product rather than pointing at it.
 *
 * The same screen serves an owner and an employee, but never the same content: the sections
 * and the feature list are filtered by role, and a capability the person cannot open is
 * still explained — with its screen omitted and a quiet "owner only" note — instead of being
 * offered as a control they do not hold. That is the difference between education and a
 * dead link, and it is resolved in one place (`featurePath`), not per row.
 *
 * It does not depend on first-run state: someone who skipped the welcome on day one opens
 * this from More and gets both halves again.
 */
export default function AppGuidePage() {
  const t = useT();
  const navigate = useNavigate();
  const base = useShellBase();
  const { isRtl } = useDir();
  const startTour = useEducationStore((s) => s.startTour);

  const [tutorialId, setTutorialId] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);

  const role = currentEduRole();
  const sections = guideForRole(role);
  // Both halves read the same filtered lists the tour and the permissions will use, so the
  // promise on this screen and what happens behind it cannot drift apart.
  const stops = visibleTourSteps(role).length;
  const features = FEATURES.map((feature) => ({ feature, path: featurePath(feature, role) }));

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />
      <NavHeader
        title={t("edu.guide.title")}
        noBack
        right={
          <button
            type="button"
            // Back to the screen that offered the guide: Settings for an owner (the fifth
            // tab, and the only menu tree), More for an employee (their shell keeps it).
            onClick={() => navigate(`${base}${isOwnerRole(role) ? "/settings" : "/more"}`)}
            aria-label={t("common.close")}
            data-testid="guide-close"
            className="ds-iconbtn"
          >
            <X size={18} />
          </button>
        }
      />

      <div className="px-4 pt-1">
        <ListCard>
          <ListRow
            icon={Compass}
            title={t("edu.guide.startTour")}
            meta={t("edu.guide.tourHint", { count: String(stops) })}
            // A tour with no steps this person may be taught is not offered as an action:
            // the row explains itself and stays inert rather than opening nothing.
            onClick={stops > 0 ? startTour : undefined}
            trailing={
              stops > 0 ? (
                <ChevronRight
                  size={14}
                  className="ds-row-chevron shrink-0"
                  style={{
                    color: "var(--text-secondary)",
                    transform: isRtl ? "rotate(180deg)" : undefined,
                  }}
                />
              ) : undefined
            }
          />
        </ListCard>
      </div>

      {/*
        * Watching beats reading for the four flows worth a full walkthrough. The recordings
        * are of this app, in Urdu, so a shopkeeper who cannot read comfortably can still learn
        * the till from the app itself.
        */}
      <div className="px-4 pt-4">
        <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
          {t("edu.tut.watch")}
        </p>
        <ListCard>
          {TUTORIALS.map((tutorial) => (
            <ListRow
              key={tutorial.id}
              icon={Play}
              title={t(tutorial.titleKey)}
              meta={t("edu.tut.urduNote")}
              onClick={() => setTutorialId(tutorial.id)}
              testId={`guide-watch-${tutorial.id}`}
              trailing={
                <ChevronRight
                  size={14}
                  className="ds-row-chevron shrink-0"
                  style={{
                    color: "var(--text-secondary)",
                    transform: isRtl ? "rotate(180deg)" : undefined,
                  }}
                />
              }
            />
          ))}
        </ListCard>
      </div>

      <div className="px-4 pt-4">
        <ListCard>
          {sections.map((section) => (
            <ListRow
              key={section.bodyKey}
              icon={section.icon}
              title={t(section.titleKey)}
              description={t(section.bodyKey)}
            />
          ))}
        </ListCard>
      </div>

      <div className="px-4 pt-4">
        <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
          {t("edu.guide.workflows")}
        </p>
        {WORKFLOWS.map((workflow) => {
          const feature = featureById(workflow.featureId);
          const path = feature ? featurePath(feature, role) : null;
          return (
            <ListCard
              key={workflow.id}
              className="mb-4"
              // A flow the person cannot run is titled as the owner's rather than hidden:
              // understanding how the shop works is part of their job even when the till
              // is not theirs to open.
              section={path ? t(workflow.titleKey) : `${t(workflow.titleKey)} · ${t("edu.guide.ownerOnly")}`}
            >
              {workflow.stepKeys.map((key, index) => (
                <ListRow key={key} tile={<StepMark n={index + 1} />} title={t(key)} />
              ))}
            </ListCard>
          );
        })}
      </div>

      {/*
        * The questions a first-time shopkeeper actually asks, answered from the app's real
        * behaviour. Answers sit open rather than behind a tap: this screen is read, not
        * operated, and an accordion would hide the one line someone came for.
        */}
      <div className="px-4 pt-4">
        <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
          {t("edu.guide.faq")}
        </p>
        <ListCard>
          {FAQS.map((faq) => (
            <ListRow
              key={faq.id}
              title={t(faq.qKey)}
              description={t(faq.aKey)}
              testId={`guide-faq-${faq.id}`}
            />
          ))}
        </ListCard>
      </div>

      <div className="px-4 pt-4">
        <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
          {t("edu.guide.features")}
        </p>
        <ListCard>
          {features.map(({ feature, path }) => (
            <ListRow
              key={feature.id}
              icon={feature.icon}
              title={t(feature.titleKey)}
              meta={t(feature.whatKey)}
              description={t(feature.whyKey)}
              // Explained either way; only offered when it is actually theirs to open.
              qualifier={path ? undefined : t("edu.guide.ownerOnly")}
              onClick={path ? () => navigate(`${base}${path}`) : undefined}
              trailing={
                path ? (
                  <ChevronRight
                    size={14}
                    className="ds-row-chevron shrink-0"
                    style={{
                      color: "var(--text-secondary)",
                      transform: isRtl ? "rotate(180deg)" : undefined,
                    }}
                  />
                ) : undefined
              }
            />
          ))}
        </ListCard>
      </div>

      {/* The way out of the guide when the guide was not enough. */}
      <div className="px-4 pt-4 pb-6">
        <ListCard>
          <ListRow
            icon={MessageCircleQuestion}
            title={t("edu.ask.title")}
            meta={t("edu.ask.hint")}
            onClick={() => setAskOpen(true)}
            testId="guide-ask"
          />
        </ListCard>
      </div>

      {tutorialId && <TutorialSheet tutorialId={tutorialId} onClose={() => setTutorialId(null)} />}
      {askOpen && <AskQuestionSheet onClose={() => setAskOpen(false)} />}
    </div>
  );
}

/**
 * A step's number, in the row's leading slot.
 *
 * Numerals rather than a glyph: the order is the instruction, and a digit cannot be
 * mistranslated. This is the same ring treatment the setup checklist uses for its steps.
 */
function StepMark({ n }: { n: number }) {
  return (
    <span
      className="size-5 rounded-full flex items-center justify-center shrink-0 text-11 font-bold"
      style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
    >
      {n}
    </span>
  );
}
