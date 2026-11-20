// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
// vi.mock calls are hoisted above this import by Vitest, so the mocks below are
// already in place when the module graph is built.
import { WorkspaceCanvas } from './WorkspaceCanvas';

/*
 * Regression test for "the brush tool stopped working".
 *
 * Reported from the deployed app: selecting Brush, drawing with the mouse, and
 * nothing appeared. The cause was not in the brush code at all — it was the
 * event wiring on the Konva Stage. Refactoring the touch handlers replaced the
 * single block of Stage props and dropped two of them along the way:
 *
 *     onMouseMove={onMouseMove}            <- deleted
 *     onMouseUp={() => void onMouseUp()}   <- deleted
 *
 * A mouse stroke is started by onMouseDown, extended by onMouseMove and saved by
 * onMouseUp. With two of those three gone the stroke was created in state and
 * never extended or committed, so the tool looked dead. Touch still worked,
 * which is why it read as a mouse-only failure.
 *
 * These assertions are deliberately about *wiring*, not behaviour: the Stage is
 * a thin wrapper over Konva and the handlers are internal closures. What can go
 * wrong — and what did go wrong — is a handler not being attached at all.
 */

// Konva needs a canvas implementation that jsdom does not provide. Only the
// props matter here, so the Stage is recorded rather than rendered.
const stageProps = vi.hoisted(() => {
  const recorded: { props: Record<string, unknown> } = { props: {} };
  return recorded;
});

vi.mock('react-konva', () => ({
  Stage: (props: Record<string, unknown>) => {
    stageProps.props = props;
    return null;
  },
  Layer: ({ children }: { children?: unknown }) => children ?? null,
  Line: () => null,
  Rect: () => null,
  Group: ({ children }: { children?: unknown }) => children ?? null,
}));

vi.mock('./CanvasNode', () => ({
  CanvasNode: () => null,
  CanvasCardOverlay: () => null,
}));

// The real hook measures a DOM node; a fixed size keeps the Stage renderable.
vi.mock('../../hooks/useCanvasSize', () => ({
  useCanvasSize: () => ({ ref: { current: null }, size: { width: 800, height: 600 } }),
}));

const noop = () => undefined;

/** The canvas reads items through `api`, so this doubles as the item source. */
function makeApi(): import('./WorkspaceCanvas').CanvasApi {
  return {
    items: [],
    createItem: () => Promise.resolve({} as never),
    patchItem: () => Promise.resolve({} as never),
    moveItems: () => Promise.resolve(),
    deleteItem: () => Promise.resolve(),
    duplicateItem: () => Promise.resolve({} as never),
    setLayer: () => Promise.resolve(),
  };
}

function renderCanvas() {
  render(
    <WorkspaceCanvas
      api={makeApi()}
      bookmarks={{}}
      media={{}}
      tool="brush"
      setTool={noop}
      canWrite
      brushColor="#080808"
      brushSize={4}
      textSize={24}
      textColor="#080808"
      selectedIds={[]}
      setSelectedIds={noop}
      onOpenTextEditor={noop}
      onCreateText={noop}
      onError={noop}
      onUndoAvailable={noop}
      onEraseNotice={noop}
    />,
  );
  return stageProps.props;
}

beforeEach(() => {
  stageProps.props = {};
});

afterEach(() => {
  cleanup();
});

describe('canvas Stage event wiring', () => {
  it('attaches a mouse move handler', () => {
    // Without this a brush stroke is never extended past its first point.
    expect(renderCanvas().onMouseMove).toBeTypeOf('function');
  });

  it('attaches a mouse up handler', () => {
    // Without this the stroke is never committed; nothing is ever saved.
    expect(renderCanvas().onMouseUp).toBeTypeOf('function');
  });

  it('attaches a mouse down handler', () => {
    expect(renderCanvas().onMouseDown).toBeTypeOf('function');
  });

  it('keeps all four touch handlers, including cancel', () => {
    const props = renderCanvas();
    for (const handler of ['onTouchStart', 'onTouchMove', 'onTouchEnd', 'onTouchCancel']) {
      expect(props[handler], `${handler} is missing`).toBeTypeOf('function');
    }
  });

  it('wires every pointer event the canvas needs, mouse and touch alike', () => {
    // A single list, so a future refactor that rewrites one group of props
    // cannot silently drop the other. Every one of these has been needed by a
    // shipped feature: brush (down/move/up), pan (drag), pinch (touch move).
    const props = renderCanvas();
    const required = [
      'onWheel',
      'onMouseDown',
      'onMouseMove',
      'onMouseUp',
      'onTouchStart',
      'onTouchMove',
      'onTouchEnd',
      'onTouchCancel',
      'onDblClick',
      'onDragStart',
      'onDragMove',
      'onDragEnd',
    ];
    const missing = required.filter((name) => props[name] === undefined);
    expect(missing, `Stage is missing: ${missing.join(', ')}`).toEqual([]);
  });
});
