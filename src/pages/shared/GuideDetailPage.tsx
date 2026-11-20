import { useNavigate, useParams } from "react-router-dom";
import { ArrowUpRight, ChevronRight, Play } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import {
  FAQS,
  FEATURES,
  WORKFLOWS,
  currentEduRole,
  featureById,
  featurePath,
  tutorialById,
} from "@/education/model";

/**
 * One guide answer, opened as its own page.
 *
 * WHY A PAGE AND NOT A SHEET (owner's request, 2026-11-15). A row in the guide used to do one of
 * two things: a walkthrough opened a sheet, and a capability jumped straight at the live screen.
 * Both skipped the part a new owner actually needs — a plain explanation of what the thing is,
 * why the shop keeps it, and the order the work happens in. Someone tapping "Selling an item"
 * got a player with no explanation, and someone tapping "Sales" landed in the till before
 * reading what it was for.
 *
 * So every guide answer now has this page: what it is, why it matters, the steps in simple
 * words, the questions people ask about it, and one button that goes to the real screen when
 * they are ready. A person who may not open the screen still gets the whole explanation — the
 * button is simply absent — because understanding the shop is part of every job.
 *
 * It is a shared page: the owner and employee shells both mount it under their own `guide`
 * route, and every destination comes from `featurePath`, so a link can never open a screen the
 * signed-in person is not allowed to see.
 */
type DetailKind = "feature" | "tutorial" | "workflow" | "step";

export default function GuideDetailPage() {
  const t = useT();
  const navigate = useNavigate();
  const base = useShellBase();
  const role = currentEduRole();
  const params = useParams<{ kind?: string; id?: string; workflowId?: string; step?: string }>();
  const kind = (params.kind ?? "") as DetailKind;
  const id = params.id ?? "";

  // A numbered step has its own page: the sentence that was tapped, the flow it belongs to,
  // and the screen that step happens on. It is addressed by workflow + position, so the URL
  // says exactly which line of which flow the reader is on.
  // The step route carries `workflowId`/`step` rather than a `kind` segment, so its presence —
  // not the kind param — is what makes this a step page.
  const stepWorkflow = params.workflowId ? WORKFLOWS.find((w) => w.id === params.workflowId) : undefined;
  const stepIndex = stepWorkflow ? Number(params.step) - 1 : -1;
  const stepKey = stepWorkflow && stepIndex >= 0 ? stepWorkflow.stepKeys[stepIndex] : undefined;

  const back = () => navigate(`${base}/guide`);

  const feature = kind === "feature" ? FEATURES.find((f) => f.id === id) : undefined;
  const tutorial = kind === "tutorial" ? tutorialById(id) : undefined;
  const workflow = kind === "workflow" ? WORKFLOWS.find((w) => w.id === id) : undefined;

  const ownerOfTutorial = tutorial ? WORKFLOWS.find((w) => w.id === tutorial.workflowId) : undefined;
  const subject = feature
    ?? (workflow ? featureById(workflow.featureId) : undefined)
    ?? (ownerOfTutorial ? featureById(ownerOfTutorial.featureId) : undefined)
    ?? (stepWorkflow ? featureById(stepWorkflow.featureId) : undefined);

  const title = feature
    ? t(feature.titleKey)
    : tutorial
      ? t(tutorial.titleKey)
      : workflow
        ? t(workflow.titleKey)
        : stepKey
          ? t(stepKey)
          : "";

  const path = subject ? featurePath(subject, role) : null;
  const steps = tutorial?.stepKeys ?? workflow?.stepKeys ?? stepWorkflow?.stepKeys ?? [];
  const questions = feature ? FAQS.filter((faq) => faq.featureId === feature.id) : [];

  if (!title) {
    return (
      <div className="flex min-h-full w-full flex-col" style={{ background: "var(--background)" }} data-testid="guide-detail">
        <StatusBar />
        <NavHeader title={t("edu.guide.title")} backTo={`${base}/guide`} onBack={back} />
        <p className="px-5 py-8 text-14" style={{ color: "var(--text-secondary)" }} data-testid="guide-detail-missing">
          {t("edu.detail.missing")}
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-full w-full flex-col"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="guide-detail"
    >
      <StatusBar />
      <NavHeader title={title} backTo={`${base}/guide`} onBack={back} />

      {/* ── What this is, in the owner's own words ─────────────────────────────────── */}
      <section className="mx-4 mt-2 rounded-[var(--radius-card)] p-4" style={{ background: "var(--tone-card)" }}>
        <p className="text-11 font-bold uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>
          {t("edu.detail.what")}
        </p>
        <p className="mt-1 text-15 font-semibold" style={{ lineHeight: 1.6 }}>
          {subject ? t(subject.whatKey) : t("edu.tut.urduNote")}
        </p>
        {subject && (
          <>
            <p className="mt-3 text-11 font-bold uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>
              {t("edu.detail.why")}
            </p>
            <p className="mt-1 text-13" style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>
              {t(subject.whyKey)}
            </p>
          </>
        )}
      </section>

      {/* ── The recording, when this answer has one ────────────────────────────────── */}
      {tutorial && (
        <div className="px-4 pt-4">
          <video
            className="w-full rounded-[var(--radius-card)]"
            style={{ background: "var(--tone-sunken)", aspectRatio: "390 / 844" }}
            src={tutorial.file}
            poster={tutorial.poster}
            controls
            playsInline
            preload="metadata"
            data-testid={`tutorial-video-${tutorial.id}`}
          />
          <p className="mt-2 text-11" style={{ color: "var(--text-tertiary)" }}>
            {t("edu.tut.urduNote")}
          </p>
        </div>
      )}

      {/* ── A step: the same flow, with this line marked and every line reachable ───── */}
      {stepWorkflow && stepKey && (
        <div className="px-4 pt-5">
          <p className="ds-section-label mb-2">{t("edu.detail.flowSteps")}</p>
          <ListCard>
            {stepWorkflow.stepKeys.map((key, index) => (
              <ListRow
                key={key}
                tile={<StepMark n={index + 1} />}
                title={t(key)}
                selected={index === stepIndex}
                emphasis={index === stepIndex}
                style={index === stepIndex ? { background: "var(--tone-sunken)" } : undefined}
                onClick={() => navigate(`${base}/guide/step/${stepWorkflow.id}/${index + 1}`)}
                testId={`guide-step-row-${stepWorkflow.id}-${index + 1}`}
                trailing={
                  index === stepIndex ? undefined : (
                    <ChevronRight
                      size={14}
                      className="ds-row-chevron shrink-0"
                      style={{ color: "var(--text-secondary)" }}
                    />
                  )
                }
              />
            ))}
          </ListCard>
        </div>
      )}

      {/* ── The order the work actually happens in ─────────────────────────────────── */}
      {!stepWorkflow && steps.length > 0 && (
        <div className="px-4 pt-5">
          <p className="ds-section-label mb-2">{t("edu.detail.steps")}</p>
          <ListCard>
            {steps.map((key, index) => (
              <ListRow key={key} tile={<StepMark n={index + 1} />} title={t(key)} />
            ))}
          </ListCard>
        </div>
      )}

      {/* ── The questions that come up about exactly this ──────────────────────────── */}
      {questions.length > 0 && (
        <div className="px-4 pt-5">
          <p className="ds-section-label mb-2">{t("edu.detail.questions")}</p>
          <ListCard>
            {questions.map((faq) => (
              <ListRow key={faq.id} title={t(faq.qKey)} description={t(faq.aKey)} />
            ))}
          </ListCard>
        </div>
      )}

      {/* ── The door to the real screen, only when it is this person's to open ─────── */}
      <div className="px-4 pt-5 pb-8">
        {path ? (
          <button
            type="button"
            onClick={() => navigate(`${base}${path}`)}
            className="ds-btn-brand h-11 w-full text-13 font-bold"
            data-testid="guide-detail-open"
          >
            <span className="me-1.5">{t("edu.detail.open")}</span>
            <ArrowUpRight size={15} />
          </button>
        ) : (
          <p className="text-12 text-center" style={{ color: "var(--text-secondary)" }} data-testid="guide-detail-locked">
            {t("edu.guide.ownerOnly")}
          </p>
        )}
      </div>

      {/* A flow with a recording but no capability link still offers the player above; nothing
          else on this page pretends to be a control. */}
      {tutorial && !subject && (
        <div className="px-4 pb-6">
          <ListRow icon={Play} title={t("edu.tut.covers")} meta={t("edu.tut.urduNote")} />
        </div>
      )}
    </div>
  );
}

/** The same numbered ring the guide and the tour use, so a step looks the same everywhere. */
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
