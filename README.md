# Scratchpad

An infinite whiteboard, shared notebook, bookmark shelf and creative workspace — built with React, TypeScript, Konva, Vite, Tailwind and Supabase, and deployed to GitHub Pages.

- **Canvas**: pan/zoom infinite stage, text, brush, eraser, select/move/resize, layers, duplicate, undo, autosave.
- **Media**: paste Google Drive *share links* (no Drive API, no OAuth, no uploads) and get image/audio/video/link cards with progressive fallbacks.
- **Bookmarks**: a per-workspace library with categories, colours and notes; drop them on the canvas as cards.
- **Teams**: owners/editors/viewers, invitations (email-bound or shareable links), member management, ownership transfer — all enforced by Postgres RLS and RPCs.
- **Collaboration**: Supabase Realtime for objects, presence avatars, version-checked writes with conflict reconciliation.

**Deploy target:** `https://godhuber.github.io/Scratchpad/`. The built bundle is already committed to
the `gh-pages` branch; Pages still has to be pointed at it (Settings → Pages → Branch `gh-pages`) or
switched to GitHub Actions — see section 4.

---

## 1. What is in this repository

```
src/
  components/        UI, canvas, teams, shared primitives
  pages/             SignIn, Workspace, Teams, Invitations, Bookmarks, Settings, JoinInvite, 404
  contexts/          Auth, Workspace (teams/invites), Toast
  hooks/             canvas items (persistence + realtime), presence, size, undo
  lib/               Drive link parsing, permissions, errors, formatting, invite links
  types/             domain types + generated-style Supabase schema types
  integrations/      Supabase client (PKCE)
  styles/            Tailwind theme + paper design system
supabase/migrations/ SQL schema, functions, RLS, realtime, hardening (applied in order)
deployment/workflows/ ci.yml + deploy.yml (source of truth; see 4.1 for why they are not in .github/)
scripts/             install-workflows.sh helper
plan.md              architecture plan and review corrections
```

---

## 2. Quick start (local)

Requirements: Node 20+ (CI uses Node 24) and npm.

```bash
npm install
cp .env.example .env.local     # then fill in your Supabase URL + publishable key
npm run dev                    # http://localhost:5173
```

Scripts:

| Script | Purpose |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | typecheck + production build |
| `npm run preview` | serve the built app |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm test` | Vitest unit tests |

### The project already pointed at a live Supabase project

`.env.production` (and your local `.env.local` if you copy it) contains a **publishable** key for project `lkxygnbvkdlwacbcbott`. Publishable keys are designed to be public — Row Level Security decides what each signed-in account can read and write. There is **no service-role/secret key anywhere in this repository or the client bundle.**

To use your own project instead, replace the two values and replay the migrations (§3).

---

## 3. Supabase setup

### 3.1 Create the project

1. <https://supabase.com/dashboard> → **New project** (free tier is fine).
2. Copy **Project URL** and the **publishable key** (Settings → API Keys → *Publishable and secret API keys*). Older projects can use the `anon` key; the client accepts `VITE_SUPABASE_ANON_KEY` as a fallback.

### 3.2 Apply the migrations

The SQL in `supabase/migrations/` is the source of truth and is applied in filename order. Two ways to run it:

**A. Supabase CLI (recommended)**

```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push          # applies every migration in order
```

**B. Dashboard SQL editor**

Open each file in order and run it:

| File | Contents |
|---|---|
| `…_init_schema.sql` | tables, constraints, indexes |
| `…_functions_core.sql` | membership helpers, profile trigger, updated_at, membership guard |
| `…_functions_workspace.sql` | `ensure_personal_workspace`, `create_team`, rename/delete/leave/remove/role/transfer |
| `…_functions_invitations.sql` | `create_invitation`, `accept_invitation`, preview, decline/revoke, expiry sweep |
| `…_functions_content.sql` | canvas items, layer order, bookmarks, media assets (all versioned) |
| `…_rls.sql` | RLS policies, column grants, `invitations_safe` view |
| `…_realtime.sql` | publication, replica identity, private presence policy |
| `…_hardening.sql` | definer hygiene fixes from the security review |
| `…_accept_addressed.sql` | accepting an email-bound invite from the Invitations page |

### 3.3 Auth redirects

Authentication → URL Configuration:

- **Site URL**: `https://<you>.github.io/<repo>/` (or `http://localhost:5173/` while developing)
- **Redirect URLs** (one per line):
  ```
  http://localhost:5173/
  http://localhost:4173/
  https://<you>.github.io/<repo>/
  https://<you>.github.io/<repo>/**
  ```
  Add your preview/CI origin if you host elsewhere (e.g. `https://*.e2b.app/**`).

The client uses **PKCE** (`flowType: 'pkce'`, `detectSessionInUrl: true`, `persistSession: true`) and computes `redirectTo` as `origin + BASE_URL`, so local, preview and Pages URLs all round-trip correctly with HashRouter.

### 3.4 Google sign-in (manual step — requires your own credentials)

I cannot create Google Cloud credentials for you. Steps:

1. <https://console.cloud.google.com> → create/select a project.
2. **APIs & Services → OAuth consent screen** → External → fill in the app name and your email; add your test users (or publish the app).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - **Authorised JavaScript origins**: `https://<you>.github.io`, `http://localhost:5173`
   - **Authorised redirect URI** (this is the *Supabase* callback, not the app):
     `https://<project-ref>.supabase.co/auth/v1/callback`
4. Supabase Dashboard → **Authentication → Providers → Google** → enable, paste Client ID + Client Secret, save.

Two different URLs are involved — don't mix them up:

| Where | Value |
|---|---|
| Google Cloud *Authorised redirect URI* | `https://<project-ref>.supabase.co/auth/v1/callback` |
| Supabase *Redirect URLs* (allow-list) | your app URLs (`http://localhost:5173/`, `https://<you>.github.io/<repo>/`, …) |

### 3.5 Email/password sign-in

Enabled by default and needs no extra configuration. On the free tier Supabase sends confirmation emails through its shared SMTP service (rate-limited); you can turn confirmation off under **Authentication → Providers → Email → Confirm email** while testing.

---

## 4. Deploying to GitHub Pages

Pick **one** of the two paths below. Path A needs no workflow permissions; path B is the CI/CD setup
that builds and verifies on every push to `main`.

### 4.0 Why there are two paths

The automation token used to scaffold this repository **cannot push `.github/workflows/**`**
(GitHub returns `403: refusing to allow a GitHub App to create or update workflow … without
'workflows' permission`) and **cannot change Pages settings** (`403`). Everything else is complete:
the workflow definitions are tested and stored in `deployment/workflows/`.

Two important consequences:

- Pages in **"Deploy from a branch"** mode runs **Jekyll**, which does not run Vite. Pointing it at
  `main` publishes raw source and the site is blank. Pointing it at a branch that contains the
  **built** files works fine — that is path A.
- Jekyll skips files and directories whose names start with `_` or `.`. `.nojekyll` is committed on
  `gh-pages` so Vite assets are served as-is.

### 4.1 Path A — publish the prebuilt bundle (no Actions needed)

`npm run build` output is committed to the orphan branch **`gh-pages`** and verified locally with a
real browser (all pages render, no console errors). To publish it:

1. Repository → **Settings → Pages**.
2. **Source: Deploy from a branch**.
3. **Branch: `gh-pages`**, folder **`/ (root)`** → Save.
4. Wait for the "pages build and deployment" run to finish, then open
   <https://godhuber.github.io/Scratchpad/>.

To refresh it after changing the app:

```bash
VITE_BASE_PATH=/Scratchpad/ npm run build
npx gh-pages -d dist --nojekyll   # or copy dist/ onto the gh-pages branch by hand
```

`gh-pages` is a **build artifact**. Never edit it by hand; the source of truth is `main`.

### 4.2 Path B — build and deploy with GitHub Actions (recommended long term)

1. Install the workflows that ship outside git:

   ```bash
   ./scripts/install-workflows.sh   # copies deployment/workflows/*.yml into .github/workflows/
   ```

   (or paste `deployment/workflows/ci.yml` and `deployment/workflows/deploy.yml` in the GitHub web
   editor). Commit and merge into `main` from an account with the `workflows` permission.
2. **Settings → Pages → Source: GitHub Actions**.
3. Push to `main` (or Actions → *Deploy to GitHub Pages* → Run workflow).

The workflow runs lint, typecheck and tests, builds with `VITE_BASE_PATH=/<repo>/`, **fails if the
Supabase URL is not baked into the bundle**, then deploys `dist/`.

Repository Variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) are **optional**. When
unset, the values committed in `.env.production` are used; the workflow only overrides them when the
variable actually has a value, so an empty variable can never blank out a working configuration.

Because the app uses **HashRouter**, deep links like `…/Scratchpad/#/invite/<token>` work on Pages
without server rewrites, and OAuth redirects return to the app root and then continue to the
remembered route.

---

### 4.3 Symptom: the site loads but the screen is blank

**This is the branch-mode trap.** If `Settings → Pages` is set to **Deploy from a branch**
(`main` / `/`), GitHub publishes your *source tree* through Jekyll. The live `index.html` then
contains `<script type="module" src="/src/main.tsx">`, which never exists on Pages, so the browser
loads nothing and you get a blank cream page.

Check what mode you are in:

```bash
gh api repos/<owner>/<repo>/pages --jq '.build_type, .source.branch, .source.path'
```

- `"legacy"` + a branch → **wrong.** The Vite build in `dist/` is not used at all.
- `"workflow"` → correct; the Actions run supplies the built artifact.

Fix — either publish the prebuilt artifact (4.1: source = branch `gh-pages`), or install the
workflow and switch the source to **GitHub Actions** (4.2).

If Pages is in "Deploy from a branch" mode pointed at `main`, the page now shows a panel saying
**"The app bundle did not load"** instead of a blank screen, because the raw `index.html` includes a
tiny inline diagnostic that runs even when the module 404s.

If the page is blank *after* switching to Actions mode, open DevTools → Console/Network. The app now
shows an explicit panel instead of a white screen for (a) an unbuilt page being served and (b) a
render-time crash, and the workflow fails the build if `VITE_SUPABASE_URL` is not baked into the
bundle.

## 5. How the Google Drive integration works (and its limits)

**No Drive API, no Google OAuth, no Picker, no SDK, no Supabase Storage.** A media card stores only a URL, file id and metadata.

Accepted link shapes:

```
https://drive.google.com/file/d/<ID>/view?usp=sharing
https://drive.google.com/file/d/<ID>/preview
https://drive.google.com/open?id=<ID>
https://drive.google.com/uc?id=<ID>&export=download
https://docs.google.com/<type>/d/<ID>/…
https://lh3.googleusercontent.com/d/<ID>
direct https media URLs (png/jpg/webp/gif, mp3/wav/m4a, mp4/webm/…)
YouTube / Vimeo (embedded), everything else becomes a link card
```

Rendering strategy per type:

| Type | First try | Fallback | Final state |
|---|---|---|---|
| Image | `lh3.googleusercontent.com/d/<id>=w2000` | Drive `/preview` iframe | "inaccessible" panel + open in Drive |
| Audio (Drive) | Drive `/preview` iframe directly | — | labelled player + open in Drive |
| Video (Drive) | Drive `/preview` iframe directly | — | same |
| Audio/video (direct https) | native `<audio>`/`<video>` | Drive preview | open original |
| Link/unknown | Drive `/preview` iframe | — | link card |

Drive audio/video used to be pointed at `drive.usercontent.google.com/download`.
That endpoint answers with `Content-Disposition: attachment`, so the browser
downloads the file instead of decoding it: every `<audio>`/`<video>` failed once
and the card then flipped to a clipped 132 px iframe on a black background, which
is what "Drive audio looks buggy" was. Drive-hosted players now go straight to
the preview iframe, which is the only Drive surface that actually streams, and
the card shows the file name and an **Open** link outside the iframe so a blocked
embed is never a blank rectangle.

Important, honest limitations:

- **Google decides access.** If the Drive file is not shared (Anyone with the link, or to the specific viewer), it will not render — Scratchpad cannot and must not work around that. The UI explains this instead of showing a broken box.
- A successful iframe *load* is never treated as proof of playback; the card always offers "open in Drive".
- File **type** cannot be read without the Drive API, so detection is a heuristic from the URL and **manual type selection is always available**.
- Drive rate-limits/hotlink policies can break `lh3` images for very popular files.
- Very large videos may not stream directly; the `/preview` iframe is the reliable path.
- Anyone holding a shareable Drive link can open the original file regardless of Scratchpad permissions. The add-media dialog warns about this.

---

## 4.4 The icon set

All UI glyphs come from `src/components/ui/Icon.tsx`: one `<path>` per icon in a
24×24 box, 2.4 stroke, round caps, `stroke="currentColor"` so the same icon sits
on mustard, mint, coral or paper without a second copy.

Never use emoji as an icon. Emoji depend on a colour-emoji font, which stripped
Linux/Windows images and many kiosk browsers do not ship — every glyph becomes a
tofu box `▯` and the toolbar looks blank. This actually shipped once.

Drawing rules, and the reason each exists:

| Rule | Why |
|---|---|
| Stay inside 0–24 with ~1.5 px margin | the toolbar button is rounded; edge-to-edge glyphs were clipped |
| Must survive **14 px** | ten call sites render at 14 px (chips, table rows, toasts). Detail under ~2 px disappears |
| Be distinct from its *neighbours* | `text` sits next to `brush`, `undo` next to `reset`, `close` next to `plus`. Each new glyph is drawn at 14/22/34 and compared in a row |
| One `<path>` | the component renders one element; extra strokes are sub-paths (`M…Z M…Z`) |

Checking a change:

```
npm run test -- src/components/ui/Icon.test.tsx   # structure, names, no duplicates
node scripts/qa/icon-sheet.mjs                    # real getBBox() in Chromium
```

`icon-sheet.mjs` fails the build if any glyph leaves the viewBox (it would be
clipped), if two glyphs have byte-identical geometry, and writes a contact sheet
to `/tmp/icons-sheet.png` showing every icon at 14, 22 and 34 px. Resemblance is
a judgement call and needs eyes; the script deliberately does not try to guess.

---

## 5a. Text, fonts and importing a font

Canvas text items store `content.fontFamily` as a plain CSS stack. Eight faces are
built in (Trebuchet, Verdana, Georgia, Times, Garamond, Courier, Comic) and need no
network access.

`Import a font…` in the text editor or the toolbox accepts:

- a Google Fonts **CSS link** (`https://fonts.googleapis.com/css2?family=…`), or
- a direct `.woff2` / `.ttf` / `.otf` URL.

Only `https:` is accepted (anything else is mixed content on the deployed site and
would fail silently). The family name is restricted to letters, digits, spaces,
`.`/`-`/`_` so it cannot break out of the CSS string it is interpolated into.
Imports are stored per device in `localStorage["scratchpad.fonts"]`; teammates need
to import the same URL to see the same face. Nothing is uploaded to Scratchpad.

---

## 5b. Retention: the 60 → 90 → 100 day cleanup pipeline

`supabase/migrations/20261119001000_retention_and_deletion.sql`

| Stage | What happens |
|---|---|
| Day 60 | flagged as idle in the UI. **Nothing is modified.** |
| Day 90 | `deleted_at` is set — the row moves to **Trash** and can be restored in one click |
| Day 100 | the row is deleted permanently |

Design choices worth knowing:

- **Soft delete, not `DELETE`.** The client only has `SELECT`; every write is a
  `SECURITY DEFINER` RPC. A sweeper that bypassed that would have no undo and no
  audit trail. `deleted_at` / `purge_after` keep every existing policy, RPC and
  realtime subscription working — the read policies simply add
  `deleted_at is null or can_edit_workspace(...)` so trash stays visible to
  editors and invisible to everyone else.
- **It ships paused.** `retention_policy.enabled` defaults to `false`. Installing
  the migration schedules the job but does not start deleting anyone's work.
  Switch it on in **Settings → Auto-cleanup**.
- **Scheduling** uses `pg_cron` when the extension is available (Supabase), and
  degrades to a `notice` with instructions to call
  `public.run_retention_sweep()` from an external scheduler when it is not.
  The function itself is revoked from `anon`/`authenticated`.
- `run_retention_sweep()` is idempotent and returns `(moved_to_trash, purged)`.

---

## 5c. Teams: roles, join links and disbanding

Everything about a team funnels through `/teams/:workspaceId`. Selecting a team
is a URL change, so the page is linkable and the back button works.

**Roles** are `owner` / `editor` / `viewer`, and the UI never pretends otherwise:
the owner sets roles from a dropdown, editors can invite and manage links, viewers
get read-only. Every one of those rules is also enforced in SQL — the buttons
merely avoid offering an action that would fail.

**Join links** are deliberately ephemeral, which is the part that surprised
people. The database stores only `token_hash`, so a raw token exists exactly once
and a link cannot be displayed after the fact. Two functions make that workable:

| Need | Function | Behaviour |
|---|---|---|
| "show me the link again" | `get_or_create_team_invite_link` | mints a new token for the team's pending shareable invite and returns it |
| "re-share / invalidate that invite" | `reissue_invitation_token` | rotates one invitation's secret; the previous link stops working |

Because the raw token is never stored, asking for the link again **replaces** it.
The UI says this next to the field rather than quietly invalidating a link
someone already sent.

**Disbanding** is owner-only, lives on the team card as well as in the detail
panel, and the confirm dialog requires typing the team name — the action deletes
every member's canvas items, bookmarks and media links at once, and there is no
undo. Editors and viewers get **Leave team** instead.

---

## 6. Security model

- All writes go through `SECURITY DEFINER` RPCs with pinned `search_path` and explicit `auth.uid()` checks. Clients have **no INSERT/UPDATE/DELETE grants** on any table — RLS cannot be bypassed by calling PostgREST directly.
- Reads are RLS-scoped to workspace members.
- Invitation tokens: 32 random bytes, only the SHA-256 hash is stored, `token_hash` is never readable by any client (a security-definer view projects the safe columns).
- `canvas_items.version` is enforced inside `update_canvas_item`; a stale client receives the newer row and reconciles instead of overwriting.
- The owner invariant (`workspaces.owner_id` ↔ owner membership row) is protected by a trigger plus atomic RPCs; the last owner can never be removed or demoted.
- Realtime: `postgres_changes` respects RLS; presence uses a **private** channel whose `realtime.messages` policy only allows members of that workspace, and `REPLICA IDENTITY FULL` makes DELETE events filterable by `workspace_id`.

Two verification passes were executed against the live project (`lkxygnbvkdlwacbcbott`):

1. A **40-assertion** SQL matrix (owner/editor/viewer/outsider, invitation lifecycle, replay, last-owner, direct-write blocking) when the migrations were applied.
2. A **live two-user probe** run as real `authenticated` sessions (`auth.users` rows created, exercised, and removed in the same call):

   | Step | Observed |
   | --- | --- |
   | `create_team` as owner | workspace created |
   | `create_invitation` (email-bound, `viewer`) | invitation row created, token returned once |
   | Unrelated signed-in user accepts | rejected `42501` |
   | Addressed invitee accepts | succeeds, returns the workspace id |
   | Invitee accepts again (replay) | rejected `22023` |
   | Viewer calls `create_canvas_item` | rejected `42501` |
   | Owner calls `create_canvas_item` | succeeds |
   | Final state | 2 members, invitation `accepted` with `accepted_by`/`accepted_at` |

   Probe rows were deleted afterwards (verified: 0 users, 0 workspaces, 0 invitations left).

## 6a. Admin console (server-side key)

`/#/admin`, linked from the bottom of the sign-in screen. It is a **separate**
identity from a normal account: no email, no Supabase user, no JWT.

- The key lives only as a **bcrypt hash** in `public.admin_config`. It is never
  in the repo, the bundle, or `localStorage`. Set or rotate it as the operator:

  ```sql
  select public.admin_set_key('a long random passphrase');
  -- key_hint shows the last four characters, e.g. ----evwr
  ```

  `admin_set_key` is executable by *nobody* through the API (`anon` and
  `authenticated` are both revoked), so it can only be run from the SQL editor
  or the service role. Rotating the key revokes every live admin session.
- A correct key is exchanged once for a 64-character random **session token**
  (SHA-256 hash stored, 8-hour expiry, revocable). Only the token is kept in the
  browser.
- **5 wrong keys in 15 minutes** locks the form for everyone until the window
  rolls over. `admin_login` returns refusals as a `reason` code rather than
  raising, precisely so the failed-attempt row survives the transaction — an
  exception would roll it back and the lockout would never count.
- What it can do: list every registered email with an online dot
  (`profiles.last_seen_at` is stamped by a `heartbeat()` RPC on app load and once
  a minute while the tab is visible — under 2 minutes reads as online), delete a
  user, set a user's password (which also deletes their `auth.sessions` and
  `auth.refresh_tokens`, so every device is signed out), delete a workspace, and
  revoke admin sessions.
- Nothing in the admin schema is readable or writable by a client: RLS is on and
  `anon`/`authenticated` have no table grants at all. The only way in is a
  `SECURITY DEFINER` RPC holding a valid token.
- **Audit log**: every action is appended to `admin_audit_log` and shown on the
  *Audit* tab. There is no delete path for it in the app.

---

## 7. Manual QA checklist

Things that can only be verified in a real browser with real accounts:

**Auth**
- [ ] Google button redirects, returns to the app and keeps the session after refresh.
- [ ] Email sign-up → confirmation mail → sign-in works.
- [ ] Sign out clears the session; visiting `/workspace` redirects to sign-in.
- [ ] Invitation link opened while signed out → sign in → lands back on `#/invite/<token>`.

**Personal workspace**
- [ ] First sign-in creates exactly one personal workspace.
- [ ] A second account cannot see it (open the same URL in a private window).

**Canvas**
- [ ] Text, brush, eraser (click any object to delete it, undo restores it), select/move/resize, duplicate, layer order, arrows to nudge, Ctrl/⌘+Z undo.
- [ ] **Drag every kind of item**: text, note, drawing stroke, image, audio, video, bookmark, link card. Only text/notes used to move.
- [ ] Dragging an **image** keeps the picture visible mid-gesture (it used to be a blank box).
- [ ] **Double-click an image / audio / video card** → full-size preview dialog. Works while signed in as a **viewer** too.
- [ ] Pressing play on an audio/video card must not drag the card.
- [ ] Add three media cards in a row: they must not overlap, and they land near what you are looking at (pan/zoom first).
- [ ] Add image / audio / video / link from the toolbar → the dialog opens with **that** type selected.
- [ ] Select a text item → change the font (8 built in); import a Google Fonts CSS link and see it apply.
- [ ] Drawing tools click *through* media cards (brush/eraser work over a card), while Select interacts with the card body (player, Open original).
- [ ] Reload restores the scene; the sync pill shows Saving → Saved.
- [ ] Two browsers on the same team: creating/moving/deleting an item appears live.
- [ ] Viewer account sees a read-only canvas and no destructive controls.

**Drive media**
- [ ] Shared image link → image card renders; **private** link → permission panel with "Open original".
- [ ] Drive audio/video shows the Drive player on a cream card with its file name and an **Open** link — never a solid black rectangle.
- [ ] Manual type override produces a working card.
- [ ] Move, resize, edit and delete a card; "Open original" opens Drive.

**Password reset**
- [ ] Sign in page has **Forgot your password?** → sends the reset mail.
- [ ] The emailed link lands on `#/reset-password` and sets a new password.

**Auto-cleanup / Trash**
- [ ] Settings → Auto-cleanup shows Day 60 / 90 / 100 and starts **Paused**.
- [ ] Canvas → **Trash** lists swept items and **Restore** puts one back.
- [ ] Settings → Your workspaces has **Delete** for a workspace you own (personal *and* team).

**Teams & invitations**
- [ ] Create **two** teams; click between their cards and confirm the detail panel follows each time.
- [ ] Reload `/teams/<id>` directly — the right team opens (the page is URL-driven).
- [ ] Team card → gear menu → Disband team is disabled until you type the team name.
- [ ] Join link: create one, open it in a private window signed in as another account, confirm the preview shows the team and the offered role.
- [ ] Ask for a fresh link and confirm the previous one no longer opens the team.
- [ ] Change a member's role from the dropdown; that account's controls change after reload.
- [ ] Create team from the hamburger menu → opens the new team's canvas, you are Owner.
- [ ] Invite by link with role Editor; accept in a second browser; realtime sync works.
- [ ] Email-bound invitation is hidden from other accounts.
- [ ] Expired/revoked/used invitation links show a clear message.
- [ ] Owner can change roles, transfer ownership, delete the team; editor/viewer cannot.
- [ ] Viewer can't add bookmarks or media (server rejects, UI explains).

**Layout**
- [ ] Phone: toolbar wraps, drawer opens, pinch zoom and touch drag work.
- [ ] Tablet/desktop: toolbox collapsible, modals usable with the keyboard.

---

## 8. Known limitations / deliberate scope

- No email delivery for invitations (no backend); links are copied and shared by you.
- No file uploads anywhere — avatars are URLs, media is links.
- Object-level realtime, not stroke-level live co-drawing.
- Undo is local and single-level per action (you, not teammates' edits).
- Rotation of canvas objects is not implemented.
- Free-tier Supabase pauses after inactivity — restore it from the dashboard.

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Supabase is not configured" banner | missing env vars | copy `.env.example` → `.env.local` |
| Google button errors `Unsupported provider` | provider not enabled | complete §3.4 |
| Redirect back to a blank page after Google login | redirect URL not allow-listed | add your exact origin (with trailing slash) in §3.3 |
| Media card says "inaccessible" | Drive file not shared | set **Anyone with the link – Viewer** |
| `42501` / permission errors | your role forbids it | ask an owner for editor access |
| Nothing syncs between browsers | Realtime publication missing | rerun `…_realtime.sql` |
| `cannot add 'presence' callbacks … after 'subscribe()'` after switching tabs | fixed in `usePresence`: the channel depended on profile fields, and token refreshes on tab focus rebuilt it mid-join | update to the latest build; the hook now keys the channel on `(workspaceId, user.id)` only and awaits teardown before re-subscribing |
| A second team cannot be opened; the panel stays on "Pick a team" | the route is `/teams/:workspaceId` but the page read `useParams().teamId`, so the selection was always undefined | fixed in `TeamsPage`; pinned by `TeamsPage.test.tsx` (5 of its 7 tests fail if the param name regresses) |
| No join link on My teams | the token is hashed and returned once, so the UI could only show a link inside the dialog that created it | `InviteLinkPanel` + migration 0011: `get_or_create_team_invite_link` mints a fresh token on demand |
| New cards all stack in one place | placement used `window.innerWidth` and ignored panning/zoom | fixed: new cards spiral to a free slot near the visible centre |
| Image card is an empty white box | the DOM overlay returned `null` for images while the shell painted an opaque background over the Konva bitmap | fixed: images render a real `<img>`; the shell is transparent for image cards |
| Drive audio is a black rectangle | `download?export=download` returns an attachment, so the player always failed, then the iframe covered the card | fixed: Drive audio goes straight to the preview iframe on a cream background with its file name and an Open link |
| Media modal always says "Image" | the clicked kind was never passed to the dialog | fixed: the toolbar button seeds `initialKind` |
| Emoji boxes (▯) in the media-type buttons | emoji glyphs depend on a colour-emoji font | replaced with the inline SVG icon set; never reintroduce emoji in UI |
| Nothing renders / blank toolbar | the icon files ran to the edge of the viewBox and the rounded button clipped them | fixed: 1.5 px margin, enforced by `scripts/qa/icon-sheet.mjs` |
| App dies on click in Safari private mode | `localStorage.setItem` throws when storage is blocked, and the call sat inside a context callback | fixed: all access goes through `src/lib/storage.ts`, which never throws |
