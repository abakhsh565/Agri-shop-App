import { useState } from "react";
import Sheet from "@/components/ui/Sheet";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useT } from "@/lib/i18n";
import { tutorialById } from "@/education/model";

/**
 * Plays one workflow walkthrough: the real app, recorded in Urdu, with the narration burned
 * into the frame.
 *
 * Two honest behaviours built in:
 *
 *   • **The steps beside the video come from the same model the video was recorded from**, so
 *     what a person reads and what they watch are the same sequence — not a video with a
 *     stale list next to it.
 *   • **A missing recording says so.** If the file is not in the build, the player is replaced
 *     by one plain line instead of an empty black rectangle: an empty player pretending to be
 *     a tutorial is worse than no tutorial.
 */
export default function TutorialSheet({ tutorialId, onClose }: { tutorialId: string; onClose: () => void }) {
  const t = useT();
  const tutorial = tutorialById(tutorialId);
  const [failed, setFailed] = useState(false);

  if (!tutorial) return null;

  return (
    <Sheet open title={t(tutorial.titleKey)} onClose={onClose}>
      <div className="px-5 pb-6" data-testid="tutorial-sheet">
        {failed ? (
          <p className="text-14 py-6" style={{ color: "var(--text-secondary)" }} data-testid="tutorial-missing">
            {t("edu.tut.notReady")}
          </p>
        ) : (
          <video
            className="w-full rounded-[var(--radius-card)]"
            style={{ background: "var(--tone-sunken)", aspectRatio: "390 / 844" }}
            src={tutorial.file}
            poster={tutorial.poster}
            controls
            playsInline
            preload="metadata"
            onError={() => setFailed(true)}
            data-testid={`tutorial-video-${tutorial.id}`}
          />
        )}

        <p className="text-11 mt-2" style={{ color: "var(--text-tertiary)" }}>
          {t("edu.tut.urduNote")}
        </p>

        <p className="ds-section-label mt-4 mb-2" style={{ color: "var(--text-secondary)" }}>
          {t("edu.tut.covers")}
        </p>
        <ListCard>
          {tutorial.stepKeys.map((key, index) => (
            <ListRow key={key} tile={<StepMark n={index + 1} />} title={t(key)} />
          ))}
        </ListCard>
      </div>
    </Sheet>
  );
}

/** The same numbered ring the guide uses, so a step looks the same everywhere. */
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
