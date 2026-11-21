import { useState, type PointerEventHandler } from 'react';
import { motion, useAnimate } from 'motion/react';
import { BORROWED, type GlyphMotion } from './borrowed';

/**
 * The animated icon renderer.
 *
 * Loaded only when an icon is first hovered (see `useAnimatedGlyph`), so
 * `motion` never enters the entry bundle. Measured cost of `motion` in the
 * entry: +55 kB gzip, which is why it is deferred rather than imported.
 *
 * Kept intentionally small: the geometry lives in `borrowed.ts`, and this file
 * only knows how to move it. Adding a glyph should never mean editing this.
 */

interface AnimatedGlyphProps {
  name: string;
  size: number;
  strokeWidth: number;
  className?: string;
  /** Forwarded from the call site so hover tooltips keep working. */
  onPointerEnter?: PointerEventHandler<SVGSVGElement>;
}

/**
 * The keyframe set per archetype.
 *
 * These are deliberately short (≈180–260 ms). An icon that animates for longer
 * than the interaction that triggered it feels laggy, and these sit in rows
 * where a pointer passes over several in a second.
 */
interface MotionSpec {
  /** Offset applied at the peak of the animation, then returned from. */
  animate: { y?: number; x?: number; scale?: number; rotate?: number; opacity?: number };
  /** Absent for `draw`, which animates pathLength instead of a transform. */
  transition?: { duration: number; ease: 'easeOut' | 'easeInOut' };
}

const MOTION_SPEC: Record<GlyphMotion, MotionSpec> = {
  draw: {
    // Nothing to transform: the strokes are revealed via pathLength instead.
    animate: {},
  },
  lift: {
    animate: { y: -1.5 },
    transition: { duration: 0.18, ease: 'easeOut' },
  },
  pop: {
    animate: { scale: 1.08 },
    transition: { duration: 0.16, ease: 'easeOut' },
  },
  wobble: {
    animate: { rotate: -6 },
    transition: { duration: 0.2, ease: 'easeOut' },
  },
  slide: {
    animate: { x: 2 },
    transition: { duration: 0.16, ease: 'easeOut' },
  },
  pulse: {
    animate: { opacity: 0.55 },
    transition: { duration: 0.2, ease: 'easeInOut' },
  },
};

export default function AnimatedGlyph({ name, size, strokeWidth, className, onPointerEnter }: AnimatedGlyphProps) {
  const glyph = BORROWED[name];
  const [scope, animate] = useAnimate();
  const [running, setRunning] = useState(false);

  if (!glyph) return null; // not a borrowed glyph; the static one stays

  const spec = MOTION_SPEC[glyph.motion];

  const play = async () => {
    if (running || !scope.current) return;
    setRunning(true);
    try {
      if (glyph.motion === 'draw') {
        // Reveal the strokes in sequence. `pathLength` is the one animation
        // that reads as "this icon is being drawn" rather than "this icon
        // moved", and it works on any path shape.
        await animate('path.glyph-stroke', { pathLength: [0, 1] }, { duration: 0.35, ease: 'easeInOut' });
      } else {
        // `scope.current` explicitly: a scoped selector like 'svg' resolves
        // against descendants, and the element being moved IS the scope root.
        await animate(scope.current, spec.animate, spec.transition ?? { duration: 0.18, ease: 'easeOut' });
        await animate(scope.current, restKeyframes(spec.animate), { duration: 0.22, ease: 'easeInOut' });
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <motion.svg
      ref={scope}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      // The wrapper that mounts this already handles pointer entry; these keep
      // keyboard focus and touch working too, so the icon is not
      // mouse-only.
      onHoverStart={() => void play()}
      onFocus={() => void play()}
      onTap={() => void play()}
      onPointerEnter={onPointerEnter}
      style={{ transformOrigin: transformOriginFor(glyph.motion) }}
    >
      {glyph.paths.map((d, index) => (
        <motion.path key={index} d={d} className="glyph-stroke" />
      ))}
    </motion.svg>
  );
}

/** The resting keyframes for a return-to-rest transition. */
function restKeyframes(anim: MotionSpec['animate']): MotionSpec['animate'] {
  const rest: MotionSpec['animate'] = {};
  // Typed field-by-field: a generic Object.fromEntries loses the union and
  // motion's animate() then rejects the whole object.
  if (anim.y !== undefined) rest.y = 0;
  if (anim.x !== undefined) rest.x = 0;
  if (anim.rotate !== undefined) rest.rotate = 0;
  if (anim.scale !== undefined) rest.scale = 1;
  if (anim.opacity !== undefined) rest.opacity = 1;
  return rest;
}

/** Where a rotation or scale should pivot. A lid tilts from its base. */
function transformOriginFor(kind: GlyphMotion): string | undefined {
  if (kind === 'wobble') return '12px 20px';
  if (kind === 'pop') return '12px 12px';
  return undefined;
}
