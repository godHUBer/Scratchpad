import { Circle, Group, Rect } from 'react-konva';
import { handlePosition, handleCursor, RESIZE_HANDLES, type ResizeHandle } from './canvasMath';
import type { CanvasItem } from '../../types';
import type { ThemeColors } from '../../hooks/useThemeColors';

interface SelectionFrameProps {
  item: CanvasItem;
  scale: number;
  canWrite: boolean;
  /** Theme-aware colours: canvas chrome, not user content. */
  colors: ThemeColors;
  onStartResize: (handle: ResizeHandle) => void;
}

export function SelectionFrame({ item, scale, canWrite, colors, onStartResize }: SelectionFrameProps) {
  const rect = { x: item.position_x, y: item.position_y, width: item.width, height: item.height };
  const size = 9 / scale;

  return (
    <Group>
      <Rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        stroke={colors.ink}
        strokeWidth={2 / scale}
        dash={[9 / scale, 6 / scale]}
        listening={false}
      />
      {canWrite
        ? RESIZE_HANDLES.map((handle) => {
            const { x, y } = handlePosition(rect, handle);
            return (
              <Circle
                key={handle}
                x={x}
                y={y}
                radius={size}
                fill="#fffdf6"
                stroke={colors.ink}
                strokeWidth={2 / scale}
                onMouseEnter={(event) => {
                  const stage = event.target.getStage();
                  if (stage) stage.container().style.cursor = handleCursor(handle);
                }}
                onMouseLeave={(event) => {
                  const stage = event.target.getStage();
                  if (stage) stage.container().style.cursor = 'default';
                }}
                onMouseDown={(event) => {
                  event.cancelBubble = true;
                  onStartResize(handle);
                }}
                onTouchStart={(event) => {
                  event.cancelBubble = true;
                  onStartResize(handle);
                }}
              />
            );
          })
        : null}
    </Group>
  );
}
