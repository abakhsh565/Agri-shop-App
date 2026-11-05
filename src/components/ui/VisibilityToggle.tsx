interface VisibilityToggleProps {
  value: boolean;
  onChange: (next: boolean) => void;
  onLabel: string;
  offLabel: string;
  /** The row this controls, for a screen reader — the two buttons alone do not say what they change. */
  ariaLabel: string;
  testId?: string;
}

/**
 * The wireframe's two-option pill: `Visible | Hidden`, `Allowed | Not allowed`.
 *
 * A switch was the wrong control here because both answers have a name, and a checkbox
 * gives only one of them a label. This is a real segmented control: two buttons, each
 * carrying `aria-pressed`, so the chosen state is announced rather than implied by colour.
 *
 * It is deliberately generic — the dashboard step and the sensitive-actions step ask
 * different questions with the same shape, and one implementation keeps them identical.
 */
export default function VisibilityToggle({
  value,
  onChange,
  onLabel,
  offLabel,
  ariaLabel,
  testId,
}: VisibilityToggleProps) {
  const itemStyle = (active: boolean) =>
    active
      ? { background: "rgba(132,204,22,0.18)", color: "var(--brand-dark)" }
      : { color: "var(--text-secondary)" };

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-testid={testId}
      className="flex items-center rounded-full p-0.5 shrink-0"
      style={{ background: "var(--tone-sunken)", border: "1px solid var(--border-control)" }}
    >
      <button
        type="button"
        aria-pressed={value}
        onClick={() => onChange(true)}
        className="h-7 px-3 rounded-full text-11 font-semibold whitespace-nowrap"
        style={itemStyle(value)}
      >
        {onLabel}
      </button>
      <button
        type="button"
        aria-pressed={!value}
        onClick={() => onChange(false)}
        className="h-7 px-3 rounded-full text-11 font-semibold whitespace-nowrap"
        style={itemStyle(!value)}
      >
        {offLabel}
      </button>
    </div>
  );
}
