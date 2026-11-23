import { useState } from 'react';
import { initials } from '../../lib/format';

const COLORS = ['#f7c948', '#7fd18b', '#8ec5ff', '#c9b6ff', '#ff8a80'];

function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 997;
  return COLORS[hash % COLORS.length]!;
}

interface AvatarProps {
  name: string | null | undefined;
  url?: string | null;
  size?: number;
  ring?: boolean;
  title?: string;
}

export function Avatar({ name, url, size = 36, ring = true, title }: AvatarProps) {
  const label = name?.trim() || 'Teammate';
  /*
    Whether the fallback is what should be painted.

    The initials used to render unconditionally, underneath a photo that was also
    always rendered. Both children were in the DOM, and the initials were
    absolutely positioned on top of the image — so whenever a profile picture was
    present the name's initials were stamped across it. Nothing here depended on
    the image having loaded.

    The image now owns the space when it can be shown, and the initials are only
    painted when there is no URL at all, or when the URL fails to load. A broken
    URL is the case the old `onError` got wrong: it hid the <img> and revealed
    nothing, leaving an empty coloured circle.
  */
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(url) && !failed;
  const style = {
    width: size,
    height: size,
    fontSize: Math.max(11, size * 0.36),
    backgroundColor: colorFor(label),
  } as const;

  return (
    <span
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-black uppercase text-ink ${
        ring ? 'border-2 border-ink' : ''
      }`}
      style={style}
      title={title ?? label}
    >
      {showImage ? (
        <img
          src={url ?? undefined}
          alt=""
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden className="absolute">
          {initials(label)}
        </span>
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}
