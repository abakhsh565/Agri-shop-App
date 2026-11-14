/**
 * Put a short piece of text on the clipboard, and say whether it actually landed.
 *
 * WHY THIS IS NOT A ONE-LINE AWAIT. In a browser that has not been granted clipboard
 * permission, `navigator.clipboard.writeText` can stay PENDING forever while its permission
 * prompt sits unanswered — the caller's await never returns and the button looks dead. So the
 * modern call is given 700 ms and then abandoned; the old selection copy is tried next, which
 * works inside a real tap and in WebViews that refuse the async API. `false` means neither
 * route worked, and the caller must say so rather than show a tick for a copy that did not
 * happen.
 */
export async function copyText(text: string): Promise<boolean> {
  let done = false;

  try {
    await Promise.race([
      navigator.clipboard.writeText(text).then(() => { done = true; }),
      new Promise((resolve) => window.setTimeout(resolve, 700)),
    ]);
  } catch {
    // Refused outright — the selection fallback below handles it.
  }

  if (!done) {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      done = document.execCommand("copy");
      document.body.removeChild(el);
    } catch {
      done = false;
    }
  }

  return done;
}
