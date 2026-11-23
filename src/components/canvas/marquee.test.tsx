// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, act } from '@testing-library/react';

/*
  Marquee box-select.

  Reported from the deployed app: hold an arrow key, press and drag over the
  canvas, a dashed box appears — and releasing it selects nothing.

  The box drawing and the selection commit were never the same event path. The
  box is driven by onMouseMove, which fires on the Stage. The commit lives in
  onMouseUp, which only fires when the pointer is released *over the Stage*.
  Since every item is a DOM card sitting in an absolutely-positioned overlay, a
  drag that starts on empty canvas and passes over a card releases on the DOM
  node — the Stage never sees the mouseup, so `hits` is never computed. The user
  sees a box that promised to select and then did nothing.

  These tests hold the release to a window listener instead of the Stage.
*/

const stageProps = vi.hoisted(() => {
  const recorded: {
    props: Record<string, unknown>;
    stage: unknown;
    pointer: { x: number; y: number };
    reset: () => void;
  } = {
    props: {},
    pointer: { x: 0, y: 0 },
    stage: null,
    reset() {
      recorded.props = {};
      recorded.pointer = { x: 0, y: 0 };
      const node: Record<string, unknown> = {
        getPointerPosition: () => recorded.pointer,
        x: () => 0,
        y: () => 0,
        scaleX: () => 1,
        scaleY: () => 1,
      };
      node.getStage = () => node;
      recorded.stage = node;
    },
  };
  recorded.reset();
  return recorded;
});

const setSelectedIds = vi.hoisted(() => vi.fn());

vi.mock('react-konva', () => ({
  Stage: (props: Record<string, unknown>) => {
    stageProps.props = props;
    /*
      Konva exposes the Stage through a ref callback, and the canvas reads the
      live pointer from `stageRef.current`. Without invoking that ref the ref
      stays null and every pointer read falls back to its default — the test
      would then be asserting against a stage that does not exist. The fake
      stage is installed here so `getPointerPosition()` is the real source.
    */
    const ref = props.ref as ((node: unknown) => void) | undefined;
    if (ref) ref(stageProps.stage);
    return null;
  },
  Layer: ({ children }: { children?: unknown }) => children ?? null,
  Line: () => null,
  Rect: () => null,
  Group: ({ children }: { children?: unknown }) => children ?? null,
}));

vi.mock('./CanvasNode', () => ({ CanvasNode: () => null, CanvasCardOverlay: () => null }));
vi.mock('../../hooks/useCanvasSize', () => ({
  useCanvasSize: () => ({ ref: { current: null }, size: { width: 800, height: 600 } }),
}));

import { WorkspaceCanvas } from './WorkspaceCanvas';
import { ThemeProvider } from '../../contexts/ThemeContext';

const noop = () => undefined;

/** Items the marquee should sweep up. Positioned in world space. */
function makeItems() {
  return [
    { id: 'a', item_type: 'text', position_x: 20, position_y: 20, width: 100, height: 60, content: {} },
    { id: 'b', item_type: 'note', position_x: 200, position_y: 200, width: 100, height: 60, content: {} },
    { id: 'c', item_type: 'bookmark', position_x: 900, position_y: 900, width: 100, height: 60, content: {} },
  ];
}

function makeApi(items: ReturnType<typeof makeItems>) {
  return {
    items,
    createItem: () => Promise.resolve({} as never),
    patchItem: () => Promise.resolve({} as never),
    moveItems: () => Promise.resolve(),
    deleteItem: () => Promise.resolve(),
    duplicateItem: () => Promise.resolve({} as never),
    setLayer: () => Promise.resolve(),
  };
}

function renderCanvas(items = makeItems()) {
  render(
    <ThemeProvider>
      <WorkspaceCanvas
        api={makeApi(items) as never}
        bookmarks={{}}
        media={{}}
        tool="select"
        setTool={noop}
        canWrite
        brushColor="#080808"
        brushSize={4}
        textSize={24}
        textColor="#080808"
        selectedIds={[]}
        setSelectedIds={setSelectedIds as never}
        onOpenTextEditor={noop}
        onCreateText={noop}
        onError={noop}
        onUndoAvailable={noop}
        onEraseNotice={noop}
      />
    </ThemeProvider>,
  );
  return stageProps.props;
}

function mouseEvent(target: unknown, pointer: { x: number; y: number }) {
  return {
    target,
    evt: { shiftKey: false, preventDefault: noop, button: 0 } as unknown as MouseEvent,
    // Konva's event objects carry the stage lazily through target.getStage().
    currentTarget: target,
    _pointer: pointer,
  };
}

afterEach(() => {
  cleanup();
  setSelectedIds.mockClear();
  stageProps.reset();
});

describe('marquee selection', () => {
  it('selects the items inside the box when released over the Stage', async () => {
    const props = renderCanvas();
    const pointer = stageProps.pointer;
    const stageNode = stageProps.stage as Record<string, unknown>;

    // Press on empty canvas.
    act(() => {
      (props.onMouseDown as (e: unknown) => void)(mouseEvent(stageNode, pointer));
    });

    // Drag across items a and b (world == screen at scale 1, origin 0,0).
    pointer.x = 260;
    pointer.y = 260;
    act(() => {
      (props.onMouseMove as () => void)();
    });

    // Re-read: the Stage is re-rendered with a fresh closure after the move, and
    // the real DOM would be holding the newest handler, not the one from mount.
    act(() => {
      (stageProps.props.onMouseUp as () => void)();
    });

    expect(setSelectedIds).toHaveBeenCalled();
    const ids = setSelectedIds.mock.calls.at(-1)?.[0] as string[];
    expect(ids.sort()).toEqual(['a', 'b']);
  });

  it('still commits when the release never reaches the Stage', async () => {
    // The bug: the pointer leaves the Stage (or lands on a DOM card overlay) and
    // the Stage's mouseup never fires. The selection must not be lost.
    const props = renderCanvas();
    const pointer = stageProps.pointer;
    const stageNode = stageProps.stage as Record<string, unknown>;

    act(() => {
      (props.onMouseDown as (e: unknown) => void)(mouseEvent(stageNode, pointer));
    });

    pointer.x = 260;
    pointer.y = 260;
    act(() => {
      (props.onMouseMove as () => void)();
    });

    // Release on the document, as a DOM card overlay would.
    await act(async () => {
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    const committed = setSelectedIds.mock.calls.some(([ids]) => Array.isArray(ids) && ids.length === 2);
    expect(committed, 'releasing over a DOM overlay must still commit the selection').toBe(true);
  });
});
