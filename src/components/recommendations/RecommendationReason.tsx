import { useT, type I18nKey } from "@/lib/i18n";
import type { RecommendationReason as Reason } from "@/lib/recommendationEngine";

/**
 * The one line under a suggested row that says why it is there.
 *
 * One line, in the language being read, with no label in front of it: a shopkeeper does not need
 * to be told that the sentence under a suggestion is the reason for it. It is the headline the
 * engine produced — the crop and what the crop needs now ("Cotton · missing from this season's
 * basket") — and the evidence the score was built from (acreage, the brand they usually buy, who
 * else in the town buys it) stays in the engine rather than turning a one-line row into a
 * paragraph.
 */
export default function RecommendationReasonLine({ reason }: { reason: Reason | undefined }) {
  const t = useT();
  if (!reason) return null;

  if (reason.key === "recommendation.stage") {
    // The stage word is a key of its own, so "sowing" is translated like everything else instead
    // of being an English word dropped into an Urdu sentence.
    const stageKey = `recommendation.stage.${reason.params.stage}` as I18nKey;
    return (
      <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>
        {t("recommendation.stage", { crop: reason.params.crop, stage: t(stageKey) })}
      </p>
    );
  }
  if (reason.key === "recommendation.recordedNeed") {
    // A recorded need is quoted as it was written — a spray programme, a pest, a job.
    return (
      <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>
        {t("recommendation.recordedNeed", { need: reason.params.need })}
      </p>
    );
  }
  return (
    <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>
      {t(reason.key, reason.params)}
    </p>
  );
}
