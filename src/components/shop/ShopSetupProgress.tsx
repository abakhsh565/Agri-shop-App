import { useT } from "@/lib/i18n";

/**
 * Setting up a shop is one job in three steps, and this is the piece of the app that says so.
 *
 * The steps are drawn as three bars filled up to the current one, then named in order: where
 * the owner is now. That is the whole point — the three steps of the flow are otherwise
 * unrelated panels of one sheet, and the owner moves between them with nothing else saying
 * "there are more of these" and "this is the last one".
 *
 * One component and one set of words for all three steps, so step 2 cannot be described as
 * "step 1 of 3" on one panel and "step 2 of 3" on the next, and so the flow's shape changes in
 * one place. Direction comes for free: the bars fill in reading order and the words are logical,
 * so in Urdu the filled bars start at the right.
 *
 * There is deliberately no list of all three steps here. The sheet is a bottom sheet, its job
 * per step is one decision, and naming the two steps the owner is not on is information they
 * cannot act on — the step they are on is stated, and the bars say how many there are.
 */
export default function ShopSetupProgress({
  step,
  className = "",
}: {
  /** Which step of the three is being shown: 1 name, 2 roles, 3 the first three tasks. */
  step: 1 | 2 | 3;
  className?: string;
}) {
  const t = useT();
  const steps: Array<{ n: 1 | 2 | 3; label: string }> = [
    { n: 1, label: t("setupFlow.nameShop") },
    { n: 2, label: t("setupFlow.rolesStep") },
    { n: 3, label: t("setupFlow.productsStep") },
  ];
  const current = steps.find((s) => s.n === step)!;

  return (
    <div data-testid="setup-flow-progress" data-step={step} className={className}>
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {steps.map((s) => (
          <span
            key={s.n}
            className="h-1 rounded-full flex-1"
            style={{ background: s.n <= step ? "var(--brand)" : "var(--divider)" }}
          />
        ))}
      </div>

      <p className="text-12 font-bold mt-2" style={{ color: "var(--text-primary)" }}>
        {t("setupFlow.stepOf", { step: String(step), total: "3" })} · {current.label}
      </p>
    </div>
  );
}
