# Architecture

A short map, so new code lands in the right place and screens do not quietly turn
back into 700-line components.

## The three layers

Every feature is split the same way. The split exists because logic buried in a
page component can only be checked by rendering the whole page, and this project
has no browser in CI.

| Layer | Lives in | Contains | Tested by |
| --- | --- | --- | --- |
| **Rules / model** | `src/lib/` | Pure functions: filtering, sorting, selection, formatting, permissions. No React, no network, no `useState`. | Unit tests, directly |
| **Behaviour** | `src/hooks/` | `useState`/`useEffect`, calling Supabase, owning modals, sequencing async work. Returns data + callbacks. | Unit tests, or by tsc |
| **Rendering** | `src/pages/`, `src/components/` | JSX. Props in, markup out. No `await`, no sorting, no filtering. | Visual / manual |

The rule of thumb: **a page component should read like a description of the
screen.** If it contains a `try`/`catch` around a network call, a non-trivial
`Array.filter`, or a rule about who may do what, that belongs one layer down.

## Worked examples

### `TeamsPage` (738 → 656 lines, plus two new files)

Before, one component held the route param, twelve pieces of state, three
effects, six async handlers with hand-written `try`/`catch`, and all the JSX.

- `src/lib/teams.ts` — pure rules: which workspaces are teams, which one the URL
  points at, which invitations are pending, who may manage. **13 unit tests.**
- `src/hooks/useTeamsPage.ts` — the state, effects and error handling. Exposes a
  data object plus named callbacks.
- `src/pages/TeamsPage.tsx` — renders that object.

The most valuable extraction was `activeTeamOf`. Its absence had already caused
a real bug: the route read a parameter that is always `undefined`, so the detail
panel never left "Pick a team". That rule is now three lines with four tests
around it, including the "id not in the list" case that must *not* fall back to
the first team.

### `AdminPage`

Already followed this shape before the convention was written down:

- `src/lib/adminUsers.ts` — search, sort, "who is online". **15 unit tests.**
  Documents that a never-seen user sorts last in *both* directions, because
  "never" is an absence rather than the oldest date.
- `src/hooks/useAdminConsole.ts` — the admin session, RPC calls, audit log.
- `src/pages/AdminPage.tsx` — the tables. 11 `useState` calls, all of which are
  pure view state (which tab, which dialog is open, the search box).

## Where things go

```
src/
  lib/          pure functions — start here, they are the cheapest to test
  hooks/        React state + side effects
  pages/        one per route, rendering only
  components/   shared UI; canvas/ and teams/ hold feature-specific pieces
  contexts/     cross-cutting providers (auth, workspace, toast)
```

## Testing budget

- `npm test` runs everything. Prefer adding tests to `src/lib/` — they need no
  DOM, no mocks and no async.
- A test that cannot fail is worse than no test. When adding a regression test,
  reintroduce the bug once and confirm the test goes red.
- Component tests needing a DOM start with `// @vitest-environment jsdom`.

## Non-React code

- `scripts/` — build and repo tooling (`check-bundle-size.mjs`,
  `install-workflows.sh`).
- `supabase/migrations/` — the schema is the source of truth for permissions;
  Row Level Security, not the client, decides what a user may read or write.
- `deployment/workflows/` — CI definitions. See `docs/INSTALL_CI.md` for why
  they are not committed under `.github/workflows/` directly.
