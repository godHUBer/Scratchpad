import { useEffect, useRef, useState } from 'react';

/** Tracks the pixel size of the canvas container (responsive + DPR aware). */
export function useCanvasSize() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const update = () => {
      const rect = node.getBoundingClientRect();
      setSize({ width: Math.max(1, Math.floor(rect.width)), height: Math.max(1, Math.floor(rect.height)) });
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener('orientationchange', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return { ref, size };
}
