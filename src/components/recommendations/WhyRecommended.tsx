import { useT, type I18nKey } from "@/lib/i18n";
import type { RecommendationReason } from "@/lib/recommendationEngine";

/**
 * The "why" under a suggested row.
 *
 * Every recommendation carries at least one reason, and the first one is the headline — the
 * agronomic answer to "why this, why now". The rest are the evidence the shop itself recorded
 * (what they usually buy, the acreage, who else in the town buys it), each on its own line
 * rather than glued into one sentence, so a shopkeeper can stop reading after the first.
 *
 * It lives in one component because both directions of the engine render the same reasons: the
 * customer's suggestions and the product's likely buyers used to be two screens with two
 * hand-written reason lines, which is how they drifted apart in the first place.
 */
export default function WhyRecommended({ reasons }: { reasons: RecommendationReason[] }) {
  const t = useT();
  if (reasons.length === 0) return null;

  const [headline, ...evidence] = reasons;
  return (
    <>
      <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>
        {t("recommendation.why")}: {render(t, headline)}
      </p>
      {evidence.length > 0 && (
        <p className="text-11 mt-0.5" style={{ color: "var(--text-tertiary)" }}>
          {evidence.slice(0, 3).map((r) => render(t, r)).join(" · ")}
        </p>
      )}
    </>
  );
}

type Translate = ReturnType<typeof useT>;

function render(t: Translate, reason: RecommendationReason): string {
  if (reason.key === "recommendation.stage") {
    // The stage word is a key of its own, so "sowing" is translated like everything else
    // instead of being an English word dropped into an Urdu sentence.
    const stageKey = `recommendation.stage.${reason.params.stage}` as I18nKey;
    return t("recommendation.stage", { crop: reason.params.crop, stage: t(stageKey) });
  }
  if (reason.key === "recommendation.recordedNeed") {
    // A recorded need is quoted as it was written — a spray programme, a pest, a job — so it is
    // not mangled by translation.
    return t("recommendation.recordedNeed", { need: reason.params.need });
  }
  return t(reason.key, reason.params);
}
