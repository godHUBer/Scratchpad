// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { SelectedCardBox } from './SelectedCardBox';
import type { CanvasItem } from '../../types';

/*
  Double-clicking a media card must open it.

  Reported as a dead gesture: the status bar says "double-click to edit", and the
  README advertises the preview, but double-clicking an image, audio, video or
  bookmark card did nothing.

  Two independent reasons, both structural rather than logic errors:

  1. `setPointerCapture` ran on *every* press. Capture retargets all later
     pointer events, including `mouseup`, to the capturing element, so the
     browser's click/dblclick counter restarted and the inner body's onDoubleClick
     never fired.
  2. A press landing on a native control (the <img>, <audio>, <video>) returned
     early from the drag path, and that path produced no click events at all.

  The shell now owns a double-click handler, and it only captures the pointer once
  the drag threshold is crossed.
*/

const ITEM: CanvasItem = {
  id: 'card-1',
  workspace_id: 'w',
  item_type: 'image',
  position_x: 40,
  position_y: 40,
  width: 320,
  height: 200,
  content: {},
  bookmark_id: null,
  media_asset_id: 'asset-1',
  created_by: 'u1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  version: 1,
};

beforeAll(() => {
  // jsdom has no pointer capture; the shell must tolerate its absence (it guards
  // the call) but the test needs to observe whether it was attempted.
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = function setPointerCapture() {};
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = function releasePointerCapture() {};
  }
});

afterEach(cleanup);

type CardProps = Partial<React.ComponentProps<typeof SelectedCardBox>>;

/** `children` is rendered explicitly, so it must not also be spread in. */
function overridesWithoutChildren({ children: _children, ...rest }: CardProps) {
  return rest as Record<string, unknown>;
}

function renderCard(overrides: CardProps = {}) {
  const onOpen = vi.fn();
  const utils = render(
    <SelectedCardBox
      item={ITEM}
      viewport={{ x: 0, y: 0, scale: 1 }}
      canWrite
      interactive
      selected={false}
      isDragging={false}
      onActivate={vi.fn()}
      onDragStart={vi.fn()}
      onDragCancel={vi.fn()}
      onDragMove={vi.fn()}
      onDragEnd={vi.fn()}
      onResizeMove={vi.fn()}
      onResizeEnd={vi.fn()}
      onOpen={onOpen}
      {...overridesWithoutChildren(overrides)}
    >
      {overrides.children ?? <div data-testid="body">card body</div>}
    </SelectedCardBox>,
  );
  return { onOpen, ...utils };
}

describe('double-click a card', () => {
  it('opens the card when the double-click lands on the shell', () => {
    const { getByText, onOpen } = renderCard();
    fireEvent.doubleClick(getByText('card body'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('opens even when the press starts on a native media control', () => {
    /*
      The second reported dead end: pressing an <audio>/<video>/<img> returned
      early from the drag path and produced no click at all. The shell's handler
      is the only one that sees this gesture.
    */
    const { container, onOpen } = renderCard({
      children: <audio data-testid="player" />,
    });
    const player = container.querySelector('[data-testid="player"]')!;
    fireEvent.doubleClick(player);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('does not capture the pointer on a plain press', () => {
    // Capture on every press is what killed the inner dblclick.
    const captured = vi.spyOn(HTMLElement.prototype, 'setPointerCapture');
    const { getByText } = renderCard();
    fireEvent.pointerDown(getByText('card body'), { pointerId: 1, clientX: 50, clientY: 50, button: 0 });
    expect(captured).not.toHaveBeenCalled();
    captured.mockRestore();
  });

  it('captures the pointer once the press becomes a drag', () => {
    // A real drag still needs capture, or it stops working past the card edge.
    const captured = vi.spyOn(HTMLElement.prototype, 'setPointerCapture');
    const { getByText } = renderCard();
    const body = getByText('card body');
    fireEvent.pointerDown(body, { pointerId: 1, clientX: 50, clientY: 50, button: 0 });
    fireEvent.pointerMove(body, { pointerId: 1, clientX: 80, clientY: 90 });
    expect(captured).toHaveBeenCalled();
    captured.mockRestore();
  });

  it('does nothing while the eraser is active', () => {
    // Erasing is a delete gesture; opening a preview mid-erase would be wrong.
    const { getByText, onOpen } = renderCard({ eraseMode: true });
    fireEvent.doubleClick(getByText('card body'));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('is inert for a viewer whose cards are not interactive', () => {
    const { getByText, onOpen } = renderCard({ interactive: false });
    fireEvent.doubleClick(getByText('card body'));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
