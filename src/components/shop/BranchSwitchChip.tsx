import { ArrowLeftRight } from "lucide-react";
import { useT } from "@/lib/i18n";

interface BranchSwitchChipProps {
  /** The branch the figures belong to. Kept as the accessible name, not as the visible label. */
  branchName: string | null | undefined;
  onClick: () => void;
  testId?: string;
  /** How wide the chip may grow before the label is cut. */
  maxWidth?: string;
  /** Layout only — the chip's shape and colours stay its own. */
  className?: string;
}

/**
 * The one branch control at the top of a report.
 *
 * It used to print the branch name itself, ellipsised to whatever the row allowed ("Al Rehman
 * Tr…") — a label that names the scope but never says it is a control, on a screen where the
 * branch is the one thing that changes every figure below it. The owner's correction: say what
 * the tap does. So the visible label is "Switch branch" with the two-arrow glyph, and the branch
 * being measured stays the accessible name, so a screen reader still hears the scope.
 *
 * One component, so Sales, Finance and Profit cannot drift into three different branch chips.
 */
export default function BranchSwitchChip({
  branchName,
  onClick,
  testId,
  maxWidth = "max-w-[10rem]",
  className = "",
}: BranchSwitchChipProps) {
  const t = useT();
  const label = t("profit.switchBranch");

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-label={branchName ? label + " · " + branchName : label}
      className={`shrink-0 flex items-center gap-1.5 h-8 ps-2.5 pe-3 rounded-full text-13 font-semibold ds-pressable ${maxWidth} ${className}`}
      style={{ background: "var(--tone-card)", color: "var(--text-primary)" }}
    >
      <ArrowLeftRight size={13} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
      <span className="truncate">{label}</span>
    </button>
  );
}
