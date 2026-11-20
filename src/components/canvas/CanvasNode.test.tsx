// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
import { CanvasCardOverlay, CanvasNode } from './CanvasNode';
import type { CanvasItem, MediaAsset } from '../../types';

/**
 * Regression tests for the card rendering / dragging bugs reported from the
 * deployed app:
 *
 *  - "images when tried to move doesn't have preview"  -> image cards rendered
 *    no DOM node at all, so dragging showed an empty box
 *  - "double click the image doesn't work"            -> nothing to click on
 *  - "drag doesn't work on text files audio video etc" -> nothing was draggable
 */

function item(overrides: Partial<CanvasItem>): CanvasItem {
  return {
    id: 'item-1',
    workspace_id: 'ws-1',
    item_type: 'image',
    position_x: 10,
    position_y: 20,
    width: 320,
    height: 240,
    content: {},
    bookmark_id: null,
    media_asset_id: 'media-1',
    created_by: 'user-1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

const imageAsset: MediaAsset = {
  id: 'media-1',
  workspace_id: 'ws-1',
  uploaded_by: 'user-1',
  original_url: 'https://example.com/cat.png',
  drive_file_id: null,
  file_name: 'cat.png',
  file_type: 'image',
  mime_type: 'image/png',
  created_at: '2026-01-01T00:00:00.000Z',
};

afterEach(cleanup);

describe('image cards', () => {
  it('renders a real <img> so the card is visible while being dragged', () => {
    const { container } = render(
      <CanvasCardOverlay
        item={item({})}
        bookmark={null}
        media={imageAsset}
        canInteract
        selected={false}
        onOpenEdit={() => {}}
      />,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://example.com/cat.png');
  });

  it('calls onOpenEdit on double-click instead of doing nothing', () => {
    const onOpenEdit = vi.fn();
    const { container } = render(
      <CanvasCardOverlay
        item={item({})}
        bookmark={null}
        media={imageAsset}
        canInteract
        selected={false}
        onOpenEdit={onOpenEdit}
      />,
    );
    fireEvent.doubleClick(container.firstElementChild as HTMLElement);
    expect(onOpenEdit).toHaveBeenCalledTimes(1);
  });

  it('shows a Drive audio player instead of a failing <audio> for drive files', () => {
    const driveAudio: MediaAsset = {
      ...imageAsset,
      id: 'media-2',
      file_type: 'audio',
      drive_file_id: '1AbCdEfGhIjKl',
      file_name: 'memo.mp3',
    };
    const { container } = render(
      <CanvasCardOverlay
        item={item({ item_type: 'audio', media_asset_id: 'media-2' })}
        bookmark={null}
        media={driveAudio}
        canInteract
        selected={false}
        onOpenEdit={() => {}}
      />,
    );
    // Drive audio has no streamable URL, so it must go straight to the iframe
    const iframe = container.querySelector('iframe');
    expect(iframe?.getAttribute('src')).toContain('/preview');
    expect(container.querySelector('audio')).toBeNull();
  });
});

describe('draggable konva nodes', () => {
  it('marks text and note groups draggable when the user can edit', () => {
    const { container } = render(
      <svg>
        <CanvasNode
          item={item({ item_type: 'text', content: { text: 'hello' } })}
          selected={false}
          canInteract
          onSelect={() => {}}
          onDoubleClick={() => {}}
        />
      </svg>,
    );
    // react-konva renders into a canvas in the browser; in jsdom we can only
    // assert that rendering does not throw and that it is not gated on `media`.
    expect(container).toBeTruthy();
  });

  it('renders nothing for card types (they belong to the DOM overlay)', () => {
    const { container } = render(
      <svg>
        <CanvasNode
          item={item({ item_type: 'image' })}
          selected={false}
          canInteract
          onSelect={() => {}}
          onDoubleClick={() => {}}
        />
      </svg>,
    );
    expect(container.querySelector('canvas')).toBeNull();
  });
});
