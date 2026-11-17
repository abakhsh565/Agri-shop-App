interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** What this switch turns on or off — the track alone says nothing to a screen reader. */
  label: string;
  testId?: string;
  disabled?: boolean;
}

/**
 * The app's one switch.
 *
 * A row's on/off answer was drawn straight into the screen that asked it, so each one had its own
 * track height and its own idea of what "on" looks like. This is that control: a 42x24 track with
 * an 18px knob, the proportions a thumb already knows from the phone's own settings.
 *
 * THE ANIMATION. The knob leans into the direction it is travelling and springs back to round — it
 * stretches for the middle of the move and settles as it lands, so the state change reads as one
 * object moving rather than a colour swap with a dot that teleports to the other end. The track's
 * colour fades underneath it. Both are transform/colour only, so the switch stays on the
 * compositor, and both are switched off under `prefers-reduced-motion` (index.css) while the knob
 * still lands in the right place.
 */
export default function Switch({ checked, onChange, label, testId, disabled = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={(event) => {
        // A switch usually sits inside a row that is itself tappable; the row's answer and the
        // switch's answer are the same one, so the tap must not be handled twice.
        event.stopPropagation();
        onChange(!checked);
      }}
      className="relative shrink-0 rounded-full transition-colors disabled:opacity-40"
      style={{
        width: 42,
        height: 24,
        background: checked ? "var(--roles-accent, var(--text-primary))" : "var(--tone-sunken)",
        border: "1px solid var(--border-control)",
        transitionDuration: "var(--dur-2)",
      }}
    >
      <span
        aria-hidden="true"
        // The key is what replays the animation on the next change; without it the class swap
        // would keep the finished keyframe applied.
        key={checked ? "on" : "off"}
        className="ds-switch-knob"
        data-on={checked ? "true" : "false"}
        style={{ background: checked ? "var(--tone-page)" : "var(--text-tertiary)" }}
      />
    </button>
  );
}
