/**
 * Bencho's VoiceNote reads eight tokens it does not define. They are mapped onto this project's
 * design system on the component's own root — not added to `:root` — so the block inherits the
 * app's ink, surface and font without opening eight new globals for every other surface to drift
 * into. That mapping is the whole adaptation, so it is pinned here: if someone rewrites the CSS
 * and drops a token, the pill silently falls back to Bencho's hex colours and stops matching the
 * rest of the product.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const CSS = readFileSync("src/index.css", "utf8");
const COMPONENT = readFileSync("src/components/ui/VoiceNote.tsx", "utf8");

const root = CSS.slice(CSS.indexOf(".vn-frame {"), CSS.indexOf("/* a fixed frame"));

/** Names this block has to provide, mapped to what the design system uses for the same job. */
const MAPPING: Record<string, string> = {
  "--fill-slab": "var(--field-bg)",
  "--fill-on": "var(--text-primary)",
  "--font-ui": "inherit",
  "--ink-3": "var(--text-tertiary)",
  "--pane-edge": "var(--hairline)",
  "--signal": "var(--brand)",
};

/** Names the project already defines in :root with the same meaning — reused, never redefined. */
const ALREADY_GLOBAL = ["--card", "--ink"];

describe("Bencho VoiceNote: tokens and scope", () => {
  it("maps every token it reads onto an existing design-system token", () => {
    for (const [token, value] of Object.entries(MAPPING)) {
      expect(root, `${token} is not mapped on .vn-frame`).toContain(`${token}: ${value};`);
    }
  });

  it("defines new names locally, and reuses the two the project already has", () => {
    // Anchored to the start of a line so the word ":root" inside prose cannot count as a rule.
    const rootBlocks = CSS.match(/^\s*:root[^{]*\{[^}]*\}/gm) ?? [];
    expect(rootBlocks.length).toBeGreaterThan(0);
    for (const token of Object.keys(MAPPING)) {
      const rootDecl = new RegExp(`^\\s*${token}:`, "m");
      for (const block of rootBlocks) expect(block, `${token} leaked into :root`).not.toMatch(rootDecl);
    }
    for (const token of ALREADY_GLOBAL) {
      // Reused from the stylesheet's own globals rather than shadowed on the component.
      expect(root, `${token} should not be redefined here`).not.toContain(`${token}:`);
      expect(CSS, `${token} is not defined globally`).toMatch(new RegExp(`^\\s*${token}:`, "m"));
    }
  });

  it("keeps the shape the comments describe: a pill that opens, a wave, a clip", () => {
    for (const part of [".vn-in", ".vn-wave", ".vn-bar", ".vn-cancel", ".vn-hint"]) {
      expect(CSS).toContain(part);
    }
    // The playhead is a CSS variable, not a render: the bar lights from --prog and its index.
    expect(CSS).toMatch(/--prog\) \* var\(--n\) - var\(--i\)/);
    expect(COMPONENT).toMatch(/export function VoiceNote\(/);
    expect(COMPONENT).toMatch(/paintProg/);
  });

  it("offers a delete both while recording and on the recorded clip", () => {
    const RECORDER = readFileSync("src/components/chat/VoiceRecorder.tsx", "utf8");
    const I18N = readFileSync("src/lib/i18n.ts", "utf8");
    // the recorder owns the whole gesture, from the idle mic to the finished clip
    expect(RECORDER).toMatch(/data-testid="voice-mic"/);
    // one control row serves both states, chosen by phase
    for (const id of ["voice-cancel", "voice-preview-discard", "voice-pause", "voice-preview-play"]) {
      expect(RECORDER, `${id} is gone`).toContain(`"${id}"`);
    }
    // the mic is the same element in every state: press to record, press to send
    expect(RECORDER).toMatch(/data-act=/);
    // both gestures are named, not left to be discovered
    expect(RECORDER).toMatch(/messages\.voiceSlideCancelShort/);
    expect(RECORDER).toMatch(/messages\.voiceSlideUpLock/);
    expect(CSS).toContain('.vr-slide');
    expect(CSS).toContain('.vr-lock-hint');
    // the bin arrives where the mic was, and the bars are thrown into it
    expect(CSS).toContain('.vr-bin');
    expect(CSS).toContain('[data-discarding] .vr-bar');
    expect(CSS).toMatch(/transition-delay: calc\(\(var\(--n\) - var\(--i\)\) \* 4ms\)/);
    // the layout the reference uses: clock and wave, then bin / wide middle button / send
    expect(CSS).toContain('.vr-pill');
    expect(CSS).toContain('.vr-controls');
    expect(CSS).toContain('.vr-delete');
    expect(CSS).toContain('.vr-mid');
    // dragging left past the threshold and up past the lock both release on pointerup
    expect(RECORDER).toMatch(/const CANCEL_PX = 90;/);
    expect(RECORDER).toMatch(/const LOCK_PX = 42;/);
    // a bumped button is not a message
    expect(RECORDER).toMatch(/const MIN_MS = 1500;/);
    expect(RECORDER).toMatch(/messages\.voiceTooShort/);
    // losing the foreground pauses instead of ending the note
    expect(RECORDER).toMatch(/visibilitychange/);
    // Bencho's pill: the slide, plus a bin while recording, and its vn-x on the clip
    expect(COMPONENT).toMatch(/className="vn-x vn-bin"/);
    expect(COMPONENT).toMatch(/className="vn-x"/);
    // one label for both, in both languages
    expect(I18N.match(/"messages\.voiceDiscard"/g)?.length).toBe(2);
  });

  it("stills its only looping animation when motion is reduced", () => {
    expect(CSS).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.vn-dot, \.vn-rec \.vn-bar, \.vn-in \{ animation: none; \}/);
  });
});
