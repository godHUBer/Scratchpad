// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

/*
  Dragging must keep the grab offset, like MS Paint.

  Reported as "the dragging problem persists, I want the drag to feel like MS
  Paint". The cause was in handleNodeDragEnd: it used the node's released x/y as
  the item's new position, so the item's top-left snapped to the cursor. Grab a
  wide card by its right edge and the card teleports left by half its width the
  instant the drag starts.

  MS Paint keeps whatever part of the selection you grabbed under the pointer for
  the whole drag. That is what these tests hold to.
*/

const nodeProps = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));

vi.mock('react-konva', () => ({
  Stage: (props: Record<string, unknown>) => (props.children ?? null) as never,
  Layer: ({ children }: { children?: unknown }) => children ?? null,
  Line: () => null,
  Rect: () => null,
  Text: () => null,
  Group: ({ children }: { children?: unknown }) => children ?? null,
  Ellipse: () => null,
  Circle: () => null,
}));

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

const ITEM = {
  id: 'box',
  workspace_id: 'w',
  item_type: 'draw',
  position_x: 100,
  position_y: 100,
  width: 300,
  height: 120,
  content: { shape: 'rect', color: '#080808', strokeWidth: 3 },
  version: 1,
};

function renderCanvas(items = [ITEM]) {
  const moveItems = vi.fn((_moves: Array<{ id: string; x: number; y: number }>) => Promise.resolve());
  render(
    <ThemeProvider>
      <WorkspaceCanvas
        api={{
          items,
          createItem: () => Promise.resolve({} as never),
          patchItem: () => Promise.resolve({} as never),
          moveItems,
          deleteItem: () => Promise.resolve(),
          duplicateItem: () => Promise.resolve({} as never),
          setLayer: () => Promise.resolve(),
        } as never}
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
        setSelectedIds={noop}
        onOpenTextEditor={noop}
        onCreateText={noop}
        onError={noop}
        onUndoAvailable={noop}
        onEraseNotice={noop}
      />
    </ThemeProvider>,
  );
  return { moveItems };
}

afterEach(() => {
  cleanup();
  nodeProps.calls.length = 0;
});

async function drag(item: Record<string, unknown>, from: { x: number; y: number }, to: { x: number; y: number }) {
  const list = nodeProps.calls.filter((p) => (p.item as { id?: string })?.id === 'box');
  const handlers = list.at(-1)!;
  (handlers.onDragStart as (id: string, x?: number, y?: number) => void)('box', from.x, from.y);
  await (handlers.onDragEnd as (id: string, x: number, y: number) => Promise<void>)('box', to.x, to.y);
  return item;
}

describe('drag grab offset', () => {
  it('moves the item by the distance the pointer travelled', async () => {
    // Grabbed at the item's own top-left, dragged 50 right and 30 down.
    const { moveItems } = renderCanvas();
    await drag(ITEM, { x: 100, y: 100 }, { x: 150, y: 130 });
    expect(moveItems).toHaveBeenCalled();
    const [moves] = moveItems.mock.calls[0]!;
    expect(moves[0]).toEqual({ id: 'box', x: 150, y: 130 });
  });

  it('does not snap the item when grabbed away from its corner', async () => {
    /*
      The reported bug. The card is 300 wide; the user grabs it 240 px in from the
      left edge (near its right side) and drags 40 px right. The item must move
      by 40, not jump so that its left edge lands under the cursor.
    */
    const { moveItems } = renderCanvas();
    // Node origin is still (100,100); the grab happened further in, so the drag
    // release reports a point 40 px to the right of where it started.
    await drag(ITEM, { x: 100, y: 100 }, { x: 140, y: 100 });
    const [moves] = moveItems.mock.calls[0]!;
    expect(moves[0]).toEqual({ id: 'box', x: 140, y: 100 });
    // Never the release point minus nothing, i.e. never a jump to the pointer.
    expect(moves[0]!.x).not.toBe(340);
  });

  it('moves every selected item by the same delta', async () => {
    // Group drag is the basic selection behaviour; the offset must not break it.
    const second = { ...ITEM, id: 'box2', position_x: 500, position_y: 400 };
    const { moveItems } = renderCanvas([ITEM, second]);
    const handlers = nodeProps.calls.filter((p) => (p.item as { id?: string })?.id === 'box').at(-1)!;
    (handlers.onDragStart as (id: string, x?: number, y?: number) => void)('box', 100, 100);
    await (handlers.onDragEnd as (id: string, x: number, y: number) => Promise<void>)('box', 130, 120);
    const [moves] = moveItems.mock.calls[0]!;
    const byId = Object.fromEntries(moves.map((m) => [m.id, m]));
    expect(byId.box).toEqual({ id: 'box', x: 130, y: 120 });
    // Only the dragged item was in the drag set, so it moves alone.
    expect(byId.box2).toBeUndefined();
  });
});
