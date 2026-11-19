export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diff = then.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;

  if (abs < minute) return 'just now';
  if (abs < hour) {
    const v = Math.round(abs / minute);
    return diff > 0 ? `in ${v} min` : `${v} min ago`;
  }
  if (abs < day) {
    const v = Math.round(abs / hour);
    return diff > 0 ? `in ${v} h` : `${v} h ago`;
  }
  if (abs < 30 * day) {
    const v = Math.round(abs / day);
    return diff > 0 ? `in ${v} d` : `${v} d ago`;
  }
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function pluralize(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}
