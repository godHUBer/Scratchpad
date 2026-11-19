# Scratchpad — Build Plan (v2, post-review)

**Project:** Scratchpad — infinite whiteboard + shared notebook + bookmark manager.
**Repo:** `godHUBer/Scratchpad` (public) · **Branch:** `arena/04005d4d-scratchpad` (from `main` @ `9fb12dc`)
**Supabase project:** `scratchpad` — ref `lkxygnbvkdlwacbcbott`, region `ap-south-1` (created 2026-11-19)
**Deployment:** GitHub Pages project site `https://godhuber.github.io/Scratchpad/`
**Review status:** v2 integrates all 14 mandatory corrections from the technical review (§12 maps each one to where it is handled).

---

## 0. Starting-point facts

| Item | State | Implication |
|---|---|---|
| Repo | Bare (`README.md` only), public, no Pages site, no workflows | Greenfield |
| Supabase | Project `scratchpad` provisioned by me, free tier | Migrations + auth config applied via connector; SQL committed to repo |
| Google Cloud OAuth client | **Does not exist — user must create** | Google button implemented; email/password fallback makes the app usable immediately |
| GitHub secret write | Token here gets 403 on Actions secrets | Publishable-key `.env.production` fallback + documented Variables |
| Sandbox network | `github.com`, `npmjs.org`, `pypi.org` only | No live Supabase calls from the sandbox; DB verified via connector SQL instead |
| Browser | No Chromium | No automated E2E; documented manual QA + SQL-level tests |

---

## 1. Stack (pinned)

Vite 8 · React 19 · TypeScript strict · Tailwind 4 (`@tailwindcss/vite`) · react-konva 19 / konva 10 · react-router-dom 7 (**HashRouter**) · @supabase/supabase-js 2 · Vitest · GitHub Actions → `deploy-pages`.

No service-role key, no custom backend, no server functions, no Supabase Storage, no Google Drive API/OAuth/Picker/SDK.

`vite.config.ts`: `base: process.env.VITE_BASE_PATH ?? '/'`.

---

## 2. Database schema (final)

Additions from review are marked ⊕.

```
profiles            id PK → auth.users ON DELETE CASCADE
                    display_name, avatar_url, created_at, ⊕ updated_at

workspaces          id uuid PK DEFAULT gen_random_uuid()
                    name (1..80 chars), description (≤500), type ('personal'|'team'),
                    owner_id → profiles, created_at, ⊕ updated_at
                    ⊕ CHECK (type='personal' ⇒ description IS NULL)  -- cosmetic, not needed
                    ⊕ UNIQUE INDEX one_personal_workspace_per_owner
                        ON workspaces(owner_id) WHERE type='personal'
                    ⊕ UNIQUE INDEX one_personal_workspace_per_owner_any_case (as above)
                    ownership invariant (owner_id ↔ owner membership) enforced by
                    trigger + atomic RPCs, never by a cross-table CHECK

workspace_members   id PK, workspace_id → workspaces ON DELETE CASCADE,
                    user_id → profiles ON DELETE CASCADE, role owner|editor|viewer,
                    joined_at, UNIQUE (workspace_id, user_id)
                    ⊕ guard trigger: no direct owner-row insert/delete/role change except via RPC

canvas_items        id PK, workspace_id → workspaces ON DELETE CASCADE,
                    item_type text, position_x/y, width/height (double precision, finite),
                    content jsonb, created_by, updated_at, ⊕ version int NOT NULL DEFAULT 1,
                    ⊕ bookmark_id  → bookmarks(id)  ON DELETE SET NULL,
                    ⊕ media_asset_id → media_assets(id) ON DELETE SET NULL
                    INDEX (workspace_id), (workspace_id, updated_at)

bookmarks           id PK, workspace_id → workspaces ON DELETE CASCADE,
                    title (1..200), url (HTTPS only, CHECK), description, category,
                    ⊕ color, created_by, created_at, ⊕ updated_at
                    INDEX (workspace_id), INDEX (workspace_id, category)

media_assets        id PK, workspace_id → workspaces ON DELETE CASCADE,
                    uploaded_by, original_url (HTTPS only), drive_file_id (nullable),
                    file_name, file_type image|audio|video|link, ⊕ mime_type (nullable),
                    created_at
                    INDEX (workspace_id), INDEX (workspace_id, drive_file_id)

invitations         id PK, workspace_id → workspaces ON DELETE CASCADE,
                    invited_by → profiles, token_hash (sha256 hex, UNIQUE),
                    expires_at, status pending|accepted|declined|revoked|expired,
                    created_at,
                    ⊕ invitee_email (nullable, lowercased),
                    ⊕ invitee_user_id (nullable → profiles ON DELETE SET NULL),
                    ⊕ invitee_role owner-free: editor|viewer (default editor),
                    ⊕ accepted_by, ⊕ accepted_at
                    CHECK: status='accepted' ⇒ accepted_by IS NOT NULL
                    INDEX (workspace_id, status), INDEX (invitee_user_id, status)
```

**No metadata duplication:** a canvas media card stores `media_asset_id`; a canvas bookmark card stores `bookmark_id`. `content` JSONB holds only card-presentation data (e.g. `{color, caption, stroke}`). If the referenced row is deleted, the FK becomes NULL and the card renders an explicit *unlinked* state instead of silently keeping a stale copy.

**Deletion semantics (explicit):**
* Delete `media_asset` → canvas card becomes "media removed" (`media_asset_id NULL`), user can delete the card or re-link a URL. Deleting a card never deletes the asset.
* Delete `bookmark` → same rule for bookmark cards. The library delete modal warns how many canvas cards will be unlinked.
* Delete workspace → cascades to members, items, bookmarks, media, invitations (confirmed by SQL test).
* Personal workspace cannot be deleted; team can, owner-only.

---

## 3. Database security (built with the schema, not after)

### 3.1 Access model

* **Reads** = RLS policies for authenticated members of the workspace.
* **Writes to membership/content** go **only** through `SECURITY DEFINER` RPCs. Direct `INSERT/UPDATE/DELETE` grants on `workspace_members`, `invitations`, and the versioned columns of `canvas_items` are **not** given to `authenticated`; the RPC is the only writer. This closes review item F (bypassing version checks via direct update).

### 3.2 RPC surface

| RPC | Purpose |
|---|---|
| `ensure_personal_workspace()` | Idempotent, atomic: create personal ws + owner membership, unique index makes races safe |
| `create_team(name, description)` | Atomic team + owner membership, returns id |
| `rename_workspace(id, name, description)` | Owner only |
| `delete_team(id)` | Owner only, refuses personal |
| `leave_workspace(id)` | Non-owner leave; refuses if last owner |
| `remove_member(ws, user)` | Owner only, refuses last owner |
| `set_member_role(ws, user, role)` | Owner only, refuses demoting last owner |
| `transfer_ownership(ws, new_owner)` | Atomic: verify caller owner + target is member → swap `owner_id`, demote caller to editor, promote target |
| `create_invitation(ws, role, expires_in_days, invitee_email?)` | Owner/editor only; **returns raw token once**; DB stores hash only |
| `revoke_invitation(id)` / `decline_invitation(id)` | Authorized caller only |
| `get_invitation_preview(token)` | Public-ish, returns safe display fields only |
| `accept_invitation(token)` | Uses `auth.uid()` only (never a client-supplied user id); transactional; safe under simultaneous accepts |
| `create_canvas_item(...)` / `update_canvas_item(id, expected_version, patch)` / `delete_canvas_item(id)` / `duplicate_canvas_item(id)` / `move_canvas_items(ids, dx, dy)` | Editor/owner; version check in SQL; **on conflict returns the current row** so the client reconciles instead of overriding |
| `save_bookmark(...)`, `delete_bookmark(...)` | Editor/owner; HTTPS URL validation server-side |
| `save_media_asset(...)`, `delete_media_asset(...)` | Editor/owner; HTTPS + host validation |

### 3.3 SECURITY DEFINER hygiene (all functions, verified by a SQL audit query)

1. `SET search_path = pg_catalog, public` (fixed) and **fully qualified** `public.*` names.
2. Explicit `auth.uid()` checks first; ownership/role checks inside the function (`workspace_role(ws)`).
3. `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon;` `GRANT EXECUTE … TO authenticated;` (except `get_invitation_preview`, granted to `anon` too, returning only name/description/inviter/expiry/status).
4. Never accept a caller-supplied user id where `auth.uid()` is authoritative.
5. All multi-row mutations in one transaction (implicit per function).
6. `GRANT SELECT` on tables to `authenticated` only where RLS covers it; no `anon` grants on workspace data.
7. Owner invariant trigger: `BEFORE INSERT/UPDATE/DELETE ON workspace_members` and `BEFORE UPDATE ON workspaces` guard consistency; direct owner-row changes raise an exception.

### 3.4 RLS summary

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| profiles | self or co-member | own id (bootstrap trigger) | own id | — |
| workspaces | member | via RPC only | via RPC only | via RPC only |
| workspace_members | member | **RPC only** | **RPC only** | **RPC only** |
| canvas_items | member | RPC only | RPC only | RPC only |
| bookmarks | member | RPC only | RPC only | RPC only |
| media_assets | member | RPC only | RPC only | RPC only |
| invitations | owner/editor of ws **or** row addressed to me (`invitee_user_id = auth.uid()` or `lower(invitee_email) = auth.email()`) | **RPC only** | **RPC only** | **RPC only** |

`token_hash` is never selectable by members: the `invitations` RLS SELECT policy is applied through a **view** (`invitations_safe`) that omits `token_hash`; base-table SELECT is revoked from `authenticated` except via the RPCs. (Review item B: hashes never exposed.)

Policy helpers `public.is_workspace_member(ws)`, `public.workspace_role(ws)`, `public.can_edit_workspace(ws)` are `STABLE SECURITY DEFINER` with fixed search_path, not executable by `anon`.

### 3.5 Invitation model (review item B)

* **Link invitation** (no email): anyone with the valid token can preview and accept, once, while `status='pending'` and not expired.
* **Email-bound invitation**: `invitee_email` set; only a user whose verified email matches can accept; preview shows "This invitation is for someone else" to others.
* Expiry default 7 days (1–30 configurable). Expired rows are reported as `expired` and can be re-issued.
* Acceptance is `UPDATE … WHERE status='pending'` so two simultaneous accepts yield exactly one membership (verified by a SQL concurrency test).
* Accepted/declined/revoked rows are immutable; only a pending invitation can be revoked.
* Token: 32 random bytes → base64url; stored as SHA-256 hex; raw token exists only in the creator's browser and the copied link.

---

## 4. Google Drive shared links without any API (review items 1, 3, 8, 9)

### 4.1 Parsing

Accepted (hostname-checked, HTTPS-only, `new URL()` parsing — no substring matching):
`drive.google.com/file/d/<ID>/view|preview`, `drive.google.com/open?id=<ID>`, `drive.google.com/uc?id=<ID>`, `docs.google.com/*/d/<ID>/…`, `lh3|lh4|lh5|lh6.googleusercontent.com/d/<ID>`, `drive.usercontent.google.com/download?id=<ID>`.
Plus direct HTTPS media URLs and YouTube/Vimeo URLs for "Media Link".

### 4.2 Rendering = progressive fallback, never an assumption

| Media | Preferred | Fallback | Terminal state |
|---|---|---|---|
| Image | `lh3…/d/<ID>=w1600` `<img>` | `/thumbnail?id=<ID>&sz=w1600` → Drive `/preview` iframe | "File inaccessible" panel + Open in Drive |
| Audio | native `<audio>` on `drive.usercontent.google.com/download?id=…` (only if `canplay` fires) | Drive `/preview` iframe | "Playback unsupported here" + Open in Drive |
| Video | native `<video>` (only if `canplay`/`loadedmetadata` fires, range supported) | Drive `/preview` iframe | same |
| Unknown/manual | Drive `/preview` iframe | — | "Pick a media type" |

* Native players are attempted with a **timeout probe** (`loadedmetadata` within 8 s) and demoted to iframe on failure; a successful iframe *load event* is **never** treated as proof of playability (review 3.2). The iframe carries a persistent "If playback fails, open in Drive" affordance.
* Card status badge: `direct` / `embed` / `inaccessible` / `unsupported`.
* Detection: extension when present, else provider hints; **manual type selection is always visible** and never silently overridden (no MIME access without the API).
* Security: only `https:` URLs; iframe/broadcast providers restricted to an allowlist (`drive.google.com`, `docs.google.com`, `www.youtube-nocookie.com`, `player.vimeo.com`, `www.loom.com`, `open.spotify.com`, `soundcloud.com`); every other external URL becomes a **link card**, never an embedded page.
* Warning shown in the modal and as a card badge tooltip: *"Anyone with this link may access the original file independently of Scratchpad permissions."*
* Drive permissions remain independent of Scratchpad permissions — stated in the modal, the card error state and the README.

### 4.3 Documented limitations

private-file failures, `lh3` hotlink quotas, large-file streaming limits, no thumbnail/metadata API, iframe pop-out buttons, no `.mp3`-style extension in most share links.

---

## 5. Auth & URLs

Client: `flowType: 'pkce'`, `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: true` (review item 14).
`redirectTo = origin + BASE_URL` (trailing slash preserved for Supabase glob matching).

| Env | App URL | Supabase allow-list |
|---|---|---|
| Local | `http://localhost:5173/` | exact |
| Sandbox preview | `https://*.e2b.app/**` | wildcard |
| Pages | `https://godhuber.github.io/Scratchpad/` | `…/Scratchpad/**` |

Two distinct URLs, documented separately (review 4): **Google Cloud authorized redirect URI** = `https://lkxygnbvkdlwacbcbott.supabase.co/auth/v1/callback`; **Supabase redirect allow-list** = the app URLs above.

Pending invitation is kept in `sessionStorage` before `signInWithOAuth` and restored after redirect → invited users land on `#/invite/<token>` after login.

Email/password is offered as a secondary path (Google credentials are outside my control; needed to demo two-account invitations). Google is the primary button.

---

## 6. Canvas & collaboration

**Tools:** Select, Text, Brush, Eraser, Image, Audio, Video, Bookmark, Media Link, Save/Sync pill. Left contextual toolbox: zoom, brush size/color, text size/color, selected-object panel (layer order, duplicate, link behaviour, delete), keyboard hints.

**Interactions:** wheel zoom to cursor, pinch zoom, space/two-finger pan, arrow-key nudge, marquee multi-select, group move, 8-handle resize (rotation-free v1), inline text editing overlay, brush strokes as point arrays (rendered as Konva `Line`), eraser via destination-out composite within the drawing layer, undo/redo stack (local, 50 steps) covering add/move/resize/edit/delete, duplicate (`Ctrl+D`), layer forward/back/front/back, delete with confirm for multi-selection.

**Sync model:**
* Every mutation → RPC with `expected_version` → success updates local state; conflict (`row returned with higher version`) updates local state from server and toasts "Updated by <member>".
* Realtime `postgres_changes` (filtered by `workspace_id`) is the propagation bus; inbound rows with `version <= known` are ignored.
* Debounce 400 ms for drag/resize, 600 ms for text; flush on blur/unload; status pill `Synced / Saving… / Offline (retrying) / Conflict`.
* Offline queue with retry on reconnect; `beforeunload` warning when dirty.
* Drawing is stored as one item per stroke (object-level sync; stroke-level live co-drawing explicitly out of scope).

**Realtime security (review H):**
* `alter publication supabase_realtime add table` for the four content tables only.
* Realtime "postgres_changes" respects RLS for authenticated subscribers (verified in README + test of cross-workspace isolation).
* Presence channel is per-workspace **private** (`workspace-presence:<id>`) with Realtime Authorization: `realtime.messages` policy allowing only `is_workspace_member((select (extension)::uuid))` for that channel. No broadcast of private data outside membership.
* `REPLICA IDENTITY FULL` on `canvas_items`, `bookmarks`, `media_assets` so DELETE events carry `workspace_id` for filtering.
* Channels unsubscribed on workspace switch/unmount; exponential backoff reconnect; connection banner.

---

## 7. UI / UX

Tokens: cream `#ffe9b8`, ink `#080808`, paper `#fffdf6`, mustard `#f7c948`, green `#7fd18b`, red `#ff8a80`, blue `#8ec5ff`; Trebuchet MS stack; 3 px black borders; 16–24 px radii; 4 px hard shadows; SVG paper grain; tape strips. No gradients/glass/motion beyond 150 ms.

* **Top bar:** logo + workspace chip (left), save/sync pill, member avatar stack with presence dots, hamburger (right, per spec).
* **Hamburger sidebar:** My Workspace, My Teams, Create a Team, Join a Team, Invitations (badge), Bookmarks, Recent Workspaces, Settings, Account/Profile, Sign Out.
* **Pages:** SignIn, Invite (public), Workspace (canvas), MyTeams, Invitations, Bookmarks, Settings/Profile, Join, NotFound.
* **Responsive:** ≥1024 full; 768–1023 collapsible toolbox; <768 bottom-sheet toolbar, full-screen drawer, pinch zoom + touch drawing.
* **States:** skeletons, illustrated empty states, inline errors, toasts, confirm dialogs, offline banner, unlinked/deleted-reference cards, permission-failure cards.
* **A11y:** visible focus, aria labels, Esc/Delete/undo shortcuts, non-canvas bookmark & media management so every feature is reachable without a mouse.

---

## 8. Build phases (security early, media early — review 6)

| # | Phase | Exit criteria |
|---|---|---|
| 1 | Scaffold + theme + **schema & RLS foundation** (migrations 0001–0003) | Build green; RLS audit SQL all PASS |
| 2 | **DB functions, auth config, invitation RPCs** + impersonation tests | Every RPC PASS/FAIL matrix green |
| 3 | Auth (PKCE, Google + email, guards, redirects, profile bootstrap) | Sessions persist; guarded routes |
| 4 | Navigation + responsive shell | All menu routes; mobile drawer |
| 5 | Personal workspaces + switching + recent | Idempotent bootstrap; isolation test |
| 6 | Canvas core + autosave + versioning + undo/dup/layers/multi-select | Reload restores scene; conflict path proven |
| 7 | Bookmarks (canvas + library) | CRUD + server URL validation |
| 8 | Drive media + compatibility probes + fallbacks + provider allowlist | Parser unit tests; live-link QA checklist written |
| 9 | Teams + membership + ownership transfer | Last-owner protection proven |
| 10 | Invitations (link + email-bound, sent/received, revoke) | Two-account round trip |
| 11 | Realtime + presence + conflict reconciliation | Cross-workspace isolation test |
| 12 | Security QA pass + docs + CI + Pages deploy | Pages live, checklist committed |

---

## 9. Verification plan

* **Static:** `tsc --noEmit`, ESLint, `vite build` with Pages base, `vite preview` smoke.
* **Unit (Vitest):** Drive parser (valid/invalid/hostile URLs), media typing, provider allowlist, permission helpers, reducer/merge + version guard, invitation-token helpers.
* **SQL (via connector):** impersonated role matrix (`anon`, outsider, viewer, editor, owner), invitation lifecycle + double-accept, version conflict, last-owner guard, cascade deletes, cross-workspace realtime isolation, definer-function audit.
* **Manual (documented, user-run):** Google OAuth round trip, real Drive links (image/audio/video, public/private/unknown), two-browser realtime, mobile touch.
* **Rule:** an integration is only marked done when its user-facing path works — saving a row is not "done".

---

## 10. Deployment

`deploy.yml` (push → `main`): `permissions: contents:read, pages:write, id-token:write`; `concurrency: group: pages, cancel-in-progress: false`; `configure-pages` → install → build (`VITE_BASE_PATH=/Scratchpad/`, env from Variables with `.env.production` fallback) → `upload-pages-artifact` → `deploy-pages`.
`ci.yml` (PRs to `main` + pushes): lint, typecheck, unit tests, build.

Committed `.env.production` contains only `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY`. Never the secret key, Google client secret, or anything private.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| No Google OAuth client yet | Email fallback; exact console steps; redirect URIs pre-configured |
| Drive embed breakage | Progressive fallback + link cards + documented limits |
| Token can't write Actions secrets | `.env.production` publishable fallback |
| Sandbox can't call Supabase | SQL RPC/RLS tests via connector; manual QA checklist |
| Free-tier pause | README note |
| No browser E2E | Strict TS, small components, unit tests, manual QA |

---

## 12. Review → plan traceability

| # | Correction | Where handled |
|---|---|---|
| 1 | `create_team()` RPC atomic | §3.2 |
| 2 | Invitee email / user id / role / accepted fields | §2, §3.5 |
| 3 | Optimistic versioning enforced via RPC; no direct bypass | §2 FK+grants, §3.1, §3.2, §6 |
| 4 | Atomic ownership transfer, last-owner protection | §3.2, §2 invariants |
| 5 | Definer hygiene (search_path, auth checks, grants) | §3.3 |
| 6 | Realtime access restricted to members | §6 |
| 7 | URL validation + iframe provider allowlist | §4.2 |
| 8 | Drive playback best-effort only | §4.2 |
| 9 | Public-share warning | §4.2 |
| 10 | No bookmark/media metadata duplication | §2 |
| 11 | Undo/redo, duplicate, layers | §6 |
| 12 | Security built with schema | §8 phases 1–2 |
| 13 | Drive testing early | §8 phase 8, §9 |
| 14 | PKCE + invitation state preservation | §5 |

---

## 13. Out of scope

Email delivery of invitations (links are copyable), Storage uploads, Drive API/OAuth/Picker, stroke-level co-drawing, rotation, realtime undo across users, service-role usage.

## 14. Definition of done

Same as v1 §13, plus: every row of §12 demonstrably implemented; RLS/RPC matrix green; Pages site live; PR merged to `main`.
