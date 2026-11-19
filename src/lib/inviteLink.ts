/** Extract an invitation token from a full link, a hash route, or a bare token. */
export function parseInviteLink(input: string): string | null {
  const value = (input ?? '').trim();
  if (!value) return null;

  const hashMatch = value.match(/#\/invite\/([A-Za-z0-9_-]{20,})/);
  if (hashMatch?.[1]) return hashMatch[1];

  const pathMatch = value.match(/\/invite\/([A-Za-z0-9_-]{20,})/);
  if (pathMatch?.[1]) return pathMatch[1];

  if (/^[A-Za-z0-9_-]{20,}$/.test(value)) return value;
  return null;
}

export function sameToken(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a === b;
}
