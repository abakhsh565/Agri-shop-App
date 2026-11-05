interface BranchKindChipProps {
  isMain: boolean;
  /** "Main" or "Sub" — the word `branchKind()` returns. */
  label: string;
}

/**
 * The one Main/Sub mark.
 *
 * It reads as a state, not a sentence: a small filled capsule that follows the branch's kind —
 * the brand tint for the branch the business started with, the sunken tone for one added later.
 * The word comes from `lib/branchKind`, so every screen spells it the same way, and this component
 * only decides how it is drawn. It is inline by design: a branch is identified by its name, and
 * the kind qualifies that name rather than competing with it.
 */
export default function BranchKindChip({ isMain, label }: BranchKindChipProps) {
  return (
    <span
      className="text-10 font-bold h-5 px-1.5 rounded-full flex items-center shrink-0"
      style={isMain
        ? { background: "var(--brand-light)", color: "var(--brand-dark)" }
        : { background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
    >
      {label}
    </span>
  );
}
