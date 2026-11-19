/** Turn Postgres / Supabase / network errors into copy a human can act on. */
export function humanizeError(error: unknown): string {
  if (!error) return 'Something went wrong.';
  const raw =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message: unknown }).message)
          : String(error);

  const text = raw.trim();
  const lower = text.toLowerCase();

  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed')) {
    return 'Network problem — check your connection and try again.';
  }
  if (lower.includes('jwt') && (lower.includes('expired') || lower.includes('invalid'))) {
    return 'Your session expired. Please sign in again.';
  }
  if (lower.includes('row-level security') || lower.includes('permission denied') || lower.includes('42501')) {
    return 'You do not have permission for that action.';
  }
  if (lower.includes('viewers cannot modify')) {
    return 'Viewers cannot change this workspace.';
  }
  if (lower.includes('only the owner')) {
    return 'Only the team owner can do that.';
  }
  if (lower.includes('invitation not found') || lower.includes('p0002')) {
    return 'That invitation link is not valid.';
  }
  if (lower.includes('expired')) {
    return 'That invitation has expired. Ask for a new link.';
  }
  if (lower.includes('already used') || lower.includes('already a member')) {
    return 'That invitation has already been used.';
  }
  if (lower.includes('different email')) {
    return 'This invitation was sent to a different email address.';
  }
  if (lower.includes('duplicate key')) {
    return 'That already exists.';
  }
  if (lower.includes('invalid login credentials')) {
    return 'Wrong email or password.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Please confirm your email address first — check your inbox.';
  }
  if (lower.includes('password should be')) {
    return 'That password is too short. Use at least 8 characters.';
  }
  if (lower.includes('user already registered')) {
    return 'An account with that email already exists. Try signing in instead.';
  }
  if (lower.includes('not authenticated')) {
    return 'Please sign in first.';
  }
  if (lower.includes('must be 1-80') || lower.includes('name required')) {
    return 'Please give it a name between 1 and 80 characters.';
  }
  if (lower.includes('only https')) {
    return 'Only https:// links are supported.';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'Too many attempts — wait a moment and try again.';
  }
  return text || 'Something went wrong.';
}
