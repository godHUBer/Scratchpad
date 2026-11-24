// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { shouldIgnoreShortcut } from './shortcuts';

/*
  Canvas shortcuts are registered on `window`, so they see every keystroke on the
  page. These are the two situations that must suppress them.

  The dialog case is a real data-loss bug, not hygiene: with a text item selected,
  opening "New bookmark", clicking Cancel and pressing Delete to fix a typo opened
  the "Delete this item?" confirmation on top of the form — and confirming it
  deletes canvas content the user was not looking at.
*/

afterEach(() => {
  document.body.innerHTML = '';
});

function keydown(target?: Element | null): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true });
  if (target) {
    Object.defineProperty(event, 'target', { value: target, configurable: true });
  }
  return event;
}

describe('typing targets', () => {
  it('ignores shortcuts typed into an input', () => {
    const input = document.createElement('input');
    document.body.append(input);
    expect(shouldIgnoreShortcut(keydown(input))).toBe(true);
  });

  it('ignores shortcuts typed into a textarea', () => {
    const area = document.createElement('textarea');
    document.body.append(area);
    expect(shouldIgnoreShortcut(keydown(area))).toBe(true);
  });

  it('ignores shortcuts typed into a contenteditable region', () => {
    const div = document.createElement('div');
    // jsdom does not derive isContentEditable from the attribute, and the
    // property is read-only, so it has to be defined.
    Object.defineProperty(div, 'isContentEditable', { value: true });
    document.body.append(div);
    expect(shouldIgnoreShortcut(keydown(div))).toBe(true);
  });

  it('ignores shortcuts on a select, where letters pick an option', () => {
    const select = document.createElement('select');
    document.body.append(select);
    expect(shouldIgnoreShortcut(keydown(select))).toBe(true);
  });

  it('lets shortcuts through from ordinary buttons', () => {
    const button = document.createElement('button');
    document.body.append(button);
    expect(shouldIgnoreShortcut(keydown(button))).toBe(false);
  });
});

describe('open dialogs', () => {
  it('ignores shortcuts while an aria-modal dialog is open', () => {
    /*
      The regression. A modal is portalled to document.body, so it is a sibling of
      the workspace rather than a descendant; the focused element is a button, and
      the old guard concluded this was ordinary canvas use.
    */
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    const button = document.createElement('button');
    dialog.append(button);
    document.body.append(dialog);

    expect(shouldIgnoreShortcut(keydown(button))).toBe(true);
  });

  it('ignores shortcuts for role="dialog" even without aria-modal', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    expect(shouldIgnoreShortcut(keydown(document.body))).toBe(true);
  });

  it('ignores shortcuts when the key press misses the dialog entirely', () => {
    // Focus can be on <body> right after a dialog opens, before its autofocus
    // lands. That is the window in which a fast Delete used to get through.
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.append(dialog);
    expect(shouldIgnoreShortcut(keydown(document.body))).toBe(true);
  });

  it('resumes shortcuts once the dialog closes', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.append(dialog);
    expect(shouldIgnoreShortcut(keydown(document.body))).toBe(true);
    dialog.remove();
    expect(shouldIgnoreShortcut(keydown(document.body))).toBe(false);
  });

  it('is not fooled by an unrelated element that merely mentions "dialog"', () => {
    // A class name or a data attribute is not a modal.
    const div = document.createElement('div');
    div.className = 'dialog-backdrop-hint';
    div.setAttribute('data-testid', 'dialog');
    document.body.append(div);
    expect(shouldIgnoreShortcut(keydown(document.body))).toBe(false);
  });
});
