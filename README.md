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
| Image | `lh3.googleusercontent.com/d/<id>=w1600` | Drive `/preview` iframe | "inaccessible" panel + open in Drive |
| Audio | native `<audio>` on `drive.usercontent.google.com/download` | Drive `/preview` iframe | "unsupported" + open in Drive |
| Video | native `<video>` (same host) | Drive `/preview` iframe | same |
| Link/unknown | Drive `/preview` iframe | — | link card |

Important, honest limitations:

- **Google decides access.** If the Drive file is not shared (Anyone with the link, or to the specific viewer), it will not render — Scratchpad cannot and must not work around that. The UI explains this instead of showing a broken box.
- A successful iframe *load* is never treated as proof of playback; the card always offers "open in Drive".
- File **type** cannot be read without the Drive API, so detection is a heuristic from the URL and **manual type selection is always available**.
- Drive rate-limits/hotlink policies can break `lh3` images for very popular files.
- Very large videos may not stream directly; the `/preview` iframe is the reliable path.
- Anyone holding a shareable Drive link can open the original file regardless of Scratchpad permissions. The add-media dialog warns about this.

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
- [ ] Drawing tools click *through* media cards (brush/eraser work over a card), while Select interacts with the card body (player, Open original).
- [ ] Reload restores the scene; the sync pill shows Saving → Saved.
- [ ] Two browsers on the same team: creating/moving/deleting an item appears live.
- [ ] Viewer account sees a read-only canvas and no destructive controls.

**Drive media**
- [ ] Shared image link → image card renders; **private** link → permission panel with "Open original".
- [ ] Audio/video: direct player if allowed, otherwise Drive preview iframe, otherwise fallback.
- [ ] Manual type override produces a working card.
- [ ] Move, resize, edit and delete a card; "Open original" opens Drive.

**Teams & invitations**
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
