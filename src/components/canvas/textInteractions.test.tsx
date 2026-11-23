// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

/*
  Text boxes: they must be draggable, and the wheel over one must resize its type.

  Both were reported together, and they had different causes:

  - Dragging failed because `nodeInteraction` was `select || eraser`. Creating a
    text box leaves the tool on 'text', so the box the user had just typed was
    not interactive at all — not merely hard to grab, but inert.
  - Wheel-to-resize did not exist. The canvas owns the wheel event for zooming,
    so a hovered text box needed an explicit branch, otherwise scrolling over it
    zoomed the whole canvas as before.
*/

const stageProps = vi.hoisted(() => {
  const recorded: {
    props: Record<string, unknown>;
    pointer: { x: number; y: number };
    hoveredId: string | null;
    stage: unknown;
  } = { props: {}, pointer: { x: 0, y: 0 }, hoveredId: null, stage: null };

  const pointer = () => recorded.pointer;
  const node: Record<string, unknown> = {
    getPointerPosition: pointer,
    x: () => 0,
    y: () => 0,
    scaleX: () => 1,
    scaleY: () => 1,
    // What Konva returns for the shape under the cursor. Null means empty space.
    getIntersection: () =>
      recorded.hoveredId
        ? { name: () => `item-${recorded.hoveredId}`, getParent: () => null }
        : null,
  };
  node.getStage = () => node;
  recorded.stage = node;
  return recorded;
});

vi.mock('react-konva', () => ({
  Stage: (props: Record<string, unknown>) => {
    stageProps.props = props;
    const ref = props.ref as ((node: unknown) => void) | undefined;
    if (ref) ref(stageProps.stage);
    // Must render its children: returning null here drops the whole Konva tree,
    // so CanvasNode would never be called and the assertion would silently pass
    // on an empty list of recorded props.
    return (props.children ?? null) as never;
  },
  Layer: ({ children }: { children?: unknown }) => children ?? null,
  Line: () => null,
  Rect: () => null,
  Text: () => null,
  Group: ({ children }: { children?: unknown }) => children ?? null,
  Ellipse: () => null,
  Circle: () => null,
}));

/** Records what each node was told about interactivity. */
const nodeProps = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
vi.mock('./CanvasNode', () => ({
  CanvasNode: (props: Record<string, unknown>) => {
    nodeProps.calls.push(props);
    return null;
  },
  CanvasCardOverlay: () => null,
}));

vi.mock('../../hooks/useCanvasSize', () => ({
  useCanvasSize: () => ({ ref: { current: null }, size: { width: 800, height: 600 } }),
}));

import { WorkspaceCanvas } from './WorkspaceCanvas';
import { ThemeProvider } from '../../contexts/ThemeContext';

const noop = () => undefined;

const TEXT_ITEM = {
  id: 'txt',
  workspace_id: 'w',
  item_type: 'text',
  position_x: 40,
  position_y: 40,
  width: 240,
  height: 90,
  content: { text: 'Hello', fontSize: 20 },
  version: 1,
};

function makeApi(items: unknown[]) {
  return {
    items,
    createItem: () => Promise.resolve({} as never),
    // Typed so `mock.calls` carries the patch argument; an untyped vi.fn infers
    // an empty tuple and every destructure of it becomes never.
    patchItem: vi.fn(
      (_id: string, _patch: { content: Record<string, unknown> }) => Promise.resolve({} as never),
    ),
    moveItems: () => Promise.resolve(),
    deleteItem: () => Promise.resolve(),
    duplicateItem: () => Promise.resolve({} as never),
    setLayer: () => Promise.resolve(),
  };
}

function renderCanvas(tool: 'select' | 'text', items: unknown[] = [TEXT_ITEM]) {
  const api = makeApi(items);
  render(
    <ThemeProvider>
      <WorkspaceCanvas
        api={api as never}
        bookmarks={{}}
        media={{}}
        tool={tool}
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
      />
    </ThemeProvider>,
  );
  return { api, props: stageProps.props };
}

afterEach(() => {
  cleanup();
  nodeProps.calls.length = 0;
  stageProps.hoveredId = null;
  stageProps.pointer = { x: 0, y: 0 };
});

describe('text boxes are draggable', () => {
  it('lets the text tool grab an existing text box', () => {
    /*
      The exact reported bug: add text, try to drag it, nothing happens. The tool
      is still 'text', and the node was excluded from interaction under it.
    */
    renderCanvas('text');
    const textNode = nodeProps.calls.find((p) => (p.item as { id?: string })?.id === 'txt');
    expect(textNode, 'the text node should be rendered').toBeTruthy();
    expect(textNode?.canInteract, 'text boxes must be draggable with the text tool').toBe(true);
  });

  it('also lets the select tool grab it', () => {
    renderCanvas('select');
    const textNode = nodeProps.calls.find((p) => (p.item as { id?: string })?.id === 'txt');
    expect(textNode?.canInteract).toBe(true);
  });

  it('does not make nodes interactive under the brush', () => {
    // The brush has to paint over a text box rather than drag it.
    renderCanvas('text');
    nodeProps.calls.length = 0;
    renderCanvas('brush' as never);
    const node = nodeProps.calls.find((p) => (p.item as { id?: string })?.id === 'txt');
    expect(node?.canInteract).toBe(false);
  });
});

describe('wheel over a text box resizes its type', () => {
  it('grows the font on scroll up', () => {
    const { api, props } = renderCanvas('select');
    stageProps.hoveredId = 'txt';
    const wheel = {
      evt: { ctrlKey: false, deltaY: -100, preventDefault: noop } as unknown as WheelEvent,
      target: stageProps.stage,
    };
    (props.onWheel as (e: unknown) => void)(wheel);
    expect(api.patchItem).toHaveBeenCalled();
    const [, patch] = api.patchItem.mock.calls[0]!;
    expect(patch.content.fontSize as number).toBeGreaterThan(20);
  });

  it('shrinks the font on scroll down', () => {
    const { api, props } = renderCanvas('select');
    stageProps.hoveredId = 'txt';
    const wheel = {
      evt: { ctrlKey: false, deltaY: 100, preventDefault: noop } as unknown as WheelEvent,
      target: stageProps.stage,
    };
    (props.onWheel as (e: unknown) => void)(wheel);
    const [, patch] = api.patchItem.mock.calls[0]!;
    expect(patch.content.fontSize as number).toBeLessThan(20);
  });

  it('zooms instead of resizing when nothing is under the cursor', () => {
    // The canvas-wide wheel zoom must survive; only a hovered text box opts out.
    const { api, props } = renderCanvas('select');
    stageProps.hoveredId = null;
    const wheel = {
      evt: { ctrlKey: false, deltaY: -100, preventDefault: noop } as unknown as WheelEvent,
      target: stageProps.stage,
    };
    (props.onWheel as (e: unknown) => void)(wheel);
    expect(api.patchItem).not.toHaveBeenCalled();
  });

  it('leaves a trackpad pinch to the zoom path', () => {
    /*
      A pinch arrives as a wheel event with ctrlKey set. Resizing the font on the
      same gesture would make zooming over a text box impossible.
    */
    const { api, props } = renderCanvas('select');
    stageProps.hoveredId = 'txt';
    const wheel = {
      evt: { ctrlKey: true, deltaY: -100, preventDefault: noop } as unknown as WheelEvent,
      target: stageProps.stage,
    };
    (props.onWheel as (e: unknown) => void)(wheel);
    expect(api.patchItem).not.toHaveBeenCalled();
  });

  it('clamps the font so scrolling cannot make text unreadably small', () => {
    const { api, props } = renderCanvas('select', [
      { ...TEXT_ITEM, content: { text: 'x', fontSize: 9 } },
    ]);
    stageProps.hoveredId = 'txt';
    const wheel = {
      evt: { ctrlKey: false, deltaY: 100, preventDefault: noop } as unknown as WheelEvent,
      target: stageProps.stage,
    };
    (props.onWheel as (e: unknown) => void)(wheel);
    const [, patch] = api.patchItem.mock.calls[0]!;
    expect(patch.content.fontSize as number).toBeGreaterThanOrEqual(8);
  });
});
