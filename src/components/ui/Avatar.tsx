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
      {url ? (
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      ) : null}
      <span aria-hidden className="absolute">
        {initials(label)}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
