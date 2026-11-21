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

## Stale builds

Routes are lazily imported, so the entry bundle requests each page by a content
hash (`SignInPage-<hash>.js`). A deploy replaces `assets/` wholesale and the new
`index.html` names new hashes. A tab that is still running the previous build —
or one served a cached `index.html` — then asks for a file that no longer
exists:

    TypeError: Failed to fetch dynamically imported module: .../SignInPage-COyBPllt.js

Nothing is wrong with the deployment; two builds of the app are alive at once.

**A plain reload does not fix this.** GitHub Pages serves `index.html` with a
cache lifetime, so re-requesting the document can be answered from the browser
cache with the *same* stale build and the *same* dead hash. `src/lib/staleBuild.ts`
therefore reloads with a cache-busting parameter, preserving the hash so the
`HashRouter` route survives, and refuses to do it twice within 30 seconds — a
reload loop is worse than an explanation. `main.tsx` clears the guard once React
mounts, which proves the browser has a coherent build.

Detection has two paths because Vite only fires `vite:preloadError` for its own
preloads; a `lazy()` rejection surfaces as a plain unhandled rejection, and the
`ErrorBoundary` catches it as a render error. Both route through the same
matcher, and that matcher must stay narrow: reloading on an ordinary exception
would throw away unsaved canvas work for nothing.

## Concurrent writes

Canvas mutations are optimistic: the UI applies the change locally, then sends
the version it *drew from* and lets the server decide. Two rules keep that
honest.

**The server reports the outcome; the client never infers it.** Both
`update_canvas_item` and `move_canvas_items` return
`(item, expected_version, conflict)`. The obvious alternative — compare the
returned version against the expected one — is wrong in a way that is easy to
miss. With a local version of 5:

| what happened | update applies? | version returned |
|---|---|---|
| our write landed | yes | 6 |
| one other write landed first | no | 6 |

Identical. The single most common collision is invisible to version arithmetic,
and an earlier implementation using `version > expected + 1` therefore dropped
the user's edit while the sync pill read "Saved, 0 conflicts". Any future change
here must keep the flag: it is knowledge the server has and the client cannot
reconstruct.

**Drags carry a version too.** `move_canvas_items` used to take none, so a stale
drag overwrote whatever another editor had done and no return value could have
revealed it. It now requires one per item and rejects the whole batch if any
item is stale — a multi-select drag is one gesture, so applying it to half the
selection would be worse than not applying it at all.

Overwriting is the right *outcome* for a drag (last writer wins on position);
what matters is that the person whose change lost can see that it lost. Retrying
automatically would just clobber the other editor in turn.

## Retention and deletion

The 60 → 90 → 100 day pipeline has **two independent gates**, and both must be
open before a single row is touched:

1. **The workspace opted in.** `workspaces.retention_enabled` defaults to
   `false`, and only that workspace's owner can flip it
   (`set_workspace_retention`). Editors can delete individual items; they cannot
   arm a job that will delete everything nobody has touched in 90 days.
2. **The operator allowed it.** `retention_policy.enabled` is a deployment-wide
   master switch, admin-only since migration 0013 (`admin_set_retention`).

`run_retention_sweep` joins `workspaces` on both the trash step *and* the purge
step, so switching a workspace off genuinely stops deletion rather than merely
pausing new arrivals in the trash.

**Why this shape.** The original design had one global row holding both the
thresholds and the switch, and `set_retention_enabled` checked nothing beyond
"is somebody signed in". Because the row was global, the first authenticated
user to press the button armed the sweep for *every* tenant on the deployment —
and the sweep ran unqualified, with no `workspace_id` filter. With open sign-up
that is a stranger scheduling the deletion of everyone's data. The singleton was
not a convenience; it was the bug. Anything that makes retention global again
reintroduces the vulnerability, which is why the client type makes the
workspace id a required prop rather than reading "the active workspace".

Authorisation is decided on the server and *reported* to the client
(`get_workspace_retention` returns `can_manage`). Hiding a button is
presentation; `supabase/tests/sql/11_retention.sql` is what proves the rule,
including the case where a row's purge date has already passed in a workspace
that never opted in.

## Theming

Colours are indirect. `@theme inline` maps every utility (`bg-paper`,
`text-ink`, `border-ink`, …) to `var(--c-*)`, and the `--c-*` values are defined
twice: once for `:root` (light) and once for `[data-theme='dark']`. Adding a
colour therefore means adding one variable in two places, never editing call
sites.

Three rules that are easy to get wrong:

1. **`--color-ink-fixed` never changes.** It is the near-black used for text and
   borders *on top of the accent colours* (mustard, coral, …). The accents stay
   bright in both themes, so flipping those to follow `--c-ink` would put white
   text on a yellow button. Use `ink-fixed` for anything sitting on an accent,
   and `ink` for anything sitting on paper.
2. **Canvas chrome must read colours through `useThemeColors()`.** Konva draws to
   a canvas and cannot resolve `var()`, so a CSS variable in a `stroke` prop
   silently fails. User content is the exception: a black brush stroke stays
   black in dark mode because it is the user's drawing, not chrome.
3. **The theme is applied before first paint.** `index.html` carries an inline
   script that sets `data-theme` before the bundle loads. Without it every dark
   mode user gets a white flash on each load. `ThemeProvider` re-applies the same
   rule; both must be kept in step, and a test covers the provider's half.

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
- **Mocking a component means its `vi.mock` replaces the module, so the props it
  receives can be asserted directly.** That is how
  `WorkspaceCanvas.events.test.tsx` pins the Konva Stage wiring. Use it for any
  third-party component whose *integration* is the fragile part: the Konva Stage
  silently lost two mouse handlers in a refactor, and because the tool still
  worked under touch, nothing surfaced it.
- Component tests needing a DOM start with `// @vitest-environment jsdom`.

## Non-React code

- `scripts/` — build and repo tooling (`check-bundle-size.mjs`,
  `install-workflows.sh`).
- `supabase/migrations/` — the schema is the source of truth for permissions;
  Row Level Security, not the client, decides what a user may read or write.
- `deployment/workflows/` — CI definitions. See `docs/INSTALL_CI.md` for why
  they are not committed under `.github/workflows/` directly.
