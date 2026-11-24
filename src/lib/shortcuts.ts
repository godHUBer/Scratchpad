/**
 * Whether a global keyboard shortcut should be ignored for this event.
 *
 * Canvas shortcuts (Delete, the V/T/B/E/H tool keys, the arrow nudge, undo) are
 * registered on `window`, so they fire for anything typed anywhere on the page.
 * Two separate situations have to suppress them, and missing the second one was
 * a data-loss bug:
 *
 * 1. The user is typing. A `Delete` inside a text field is an edit, not a
 *    "remove the selected canvas item".
 *
 * 2. A dialog is open. Modals are rendered through a portal to `document.body`,
 *    which makes them *siblings* of the workspace, not descendants — so a key
 *    pressed while a button inside a dialog has focus still has a page-level
 *    target and looked like ordinary canvas use. Reported reproduction: select a
 *    text item, open "New bookmark", click Cancel, press Delete to fix a typo,
 *    and the "Delete this item?" confirmation stacked on top of the form the
 *    user was still looking at.
 *
 * Shortcuts that belong to the page also have no business running underneath a
 * dialog: pressing an arrow key while filling in a bookmark title was nudging the
 * selected canvas item behind it.
 *
 * Read as a target query rather than a React state flag on purpose: the dialogs
 * are owned by several components and a prop threaded through all of them would
 * be out of date for exactly one render after a dialog opens — long enough for a
 * fast key press to slip through.
 */

/** Elements whose keystrokes belong to the field, not to the page. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const element = target as HTMLElement;
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') return true;
  if (element.isContentEditable) return true;
  // `<select>` responds to arrow keys and letters; treating it as a canvas
  // shortcut target changed the value the user was picking.
  if (element.tagName === 'SELECT') return true;
  return false;
}

/** True while any modal is on screen. */
function dialogIsOpen(doc: Document): boolean {
  // `aria-modal` is what the shared Modal component sets; `role="dialog"` is the
  // fallback so a dialog implemented elsewhere still suppresses shortcuts.
  return Boolean(doc.querySelector('[aria-modal="true"], [role="dialog"]'));
}

export function shouldIgnoreShortcut(event: KeyboardEvent): boolean {
  if (isTypingTarget(event.target)) return true;
  const doc = (event.target as Node | null)?.ownerDocument ?? globalThis.document;
  if (!doc) return false;
  return dialogIsOpen(doc);
}

/** Exported for the tests and for any other page with global shortcuts. */
export const __internals = { isTypingTarget, dialogIsOpen };
