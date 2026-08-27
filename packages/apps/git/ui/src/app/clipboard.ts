// com.ikenga.git · clipboard (WP-10, R6)
//
// Deliberately NOT in bridge.ts: this reaches no host verb at all. It exists
// because "Send to your Chi" cannot actually send — the shell's pkg-iframe
// dispatcher has no `host.sendToActiveSession` case (`shell/src/components/
// pkg/pkg-iframe-host.tsx`; the call falls through to 'unknown host tool').
// The studio helper that was cited as precedent calls the same non-existent
// verb, so it is stale, not proof. Rather than ship a button that reports
// success for a delivery that never happened, the pkg puts the prompt on the
// clipboard and says so.
//
// TODO(shell): when `host.sendToActiveSession` lands in the dispatcher, this
// becomes the fallback for the refusal paths ('no-active-session',
// 'scope-denied', standalone dev) rather than the whole story —
// ikenga-hq/ikenga#127.

/**
 * Copy `text`, returning whether it landed. Never throws and never rejects —
 * a failed copy is a UI state ("copy it yourself"), not an exception.
 *
 * Two paths, because the modern one is not always available in a pkg iframe:
 * `navigator.clipboard.writeText` needs a secure context AND (in some engines)
 * transient user activation, and a sandboxed iframe without
 * `allow="clipboard-write"` rejects it outright. The `execCommand('copy')`
 * fallback is deprecated but is the only thing that works in those cases; it
 * needs a real, selectable, on-screen-ish node, hence the off-viewport
 * textarea rather than `display: none` (a hidden node cannot be selected).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    const clip = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } })
      .navigator?.clipboard;
    if (clip?.writeText) {
      await clip.writeText(text);
      return true;
    }
  } catch {
    // fall through — a rejection here is exactly the case the fallback exists for
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  // Off-viewport, not hidden: `display:none` / `visibility:hidden` nodes are
  // not selectable, which is the one thing this technique requires.
  ta.style.position = 'fixed';
  ta.style.top = '-1000px';
  ta.style.left = '-1000px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  try {
    ta.select();
    const legacy = document as Document & { execCommand?: (c: string) => boolean };
    return legacy.execCommand?.('copy') === true;
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}
