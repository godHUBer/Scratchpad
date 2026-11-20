/**
 * localStorage that cannot take the app down.
 *
 * `localStorage` throws, not just returns null, when storage is unavailable:
 * Safari private browsing, an enterprise policy, a third-party iframe with
 * storage blocked, or a full quota. An unguarded `setItem` in a click handler
 * throws a SecurityError and — because these run inside context callbacks —
 * takes the whole workspace tree down with it.
 *
 * These helpers make every call best-effort. Losing a remembered workspace id
 * is a nuisance; losing the canvas is not.
 */

type Key = string;

function store(): Storage | null {
  try {
    // Accessing the property itself can throw, so probe with a real write.
    const probe = '__scratchpad_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readString(key: Key): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeString(key: Key, value: string): boolean {
  try {
    const s = store();
    if (!s) return false;
    s.setItem(key, value);
    return true;
  } catch {
    // Quota exceeded or a racing revoke of storage permission.
    return false;
  }
}

export function readJson<T>(key: Key, fallback: T, isValid: (v: unknown) => v is T): T {
  const raw = readString(key);
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: Key, value: unknown): boolean {
  try {
    return writeString(key, JSON.stringify(value));
  } catch {
    // Circular structure or a value JSON cannot represent.
    return false;
  }
}
