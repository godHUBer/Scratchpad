# Installing CI

`ci.yml` is ready. It cannot be committed from automation because the GitHub App that
works on this repository has no `workflows` permission:

```
refusing to allow a GitHub App to create or update workflow `.github/workflows/ci.yml`
without `workflows` permission
```

A human with write access has to paste it once. That is the only step, and it takes about
a minute.

---

## Where it goes

**Path: `.github/workflows/ci.yml`** — that exact name, in that exact folder, at the
repository root. Not `deployment/workflows/`.

The file to paste is **`docs/ci.yml`** (identical to `deployment/workflows/ci.yml`).

---

## Option A — GitHub web editor (easiest)

1. Open the repository, then go to:
   <https://github.com/godHUBer/Scratchpad/new/main/.github/workflows>
2. In **File name** type: `ci.yml`
3. Click **Edit new file** if the editor shows a preview, then paste the whole of
   `docs/ci.yml`.
4. Commit directly to `main` (or open a branch and merge).
5. Go to **Actions** — you should see **CI** in the left sidebar, and a run for your
   commit.

> If step 1 gives a 404, the folder simply does not exist yet. Go to **Add file → Create
> new file** and type the full path `​.github/workflows/ci.yml` in the name box; GitHub
> creates the folders for you.

## Option B — from a clone

```bash
cp docs/ci.yml .github/workflows/ci.yml
git add .github/workflows/ci.yml
git commit -m "Install CI workflow"
git push
```

Use an account or token that has the `workflows` permission. A fine-grained token needs
**Workflows: Read and write** under *Repository permissions*.

---

## What it runs

Two jobs, in parallel, on every pull request to `main` and every push to `main`/`arena/**`:

| Job | Steps | Catches |
|---|---|---|
| `verify` | `npm ci`, lint, typecheck, unit tests (193), production build, bundle-config check | type errors, broken tests, a build that would ship the "not configured" screen |
| `database` | installs `pgserver`, applies all 12 migrations to a real PostgreSQL, calls every admin RPC | a migration that compiles but raises when invoked — the exact class of bug that shipped in `admin_list_users` |

Both were rehearsed end to end from a clean checkout before being handed over, including
a negative test of the bundle-config check (a wrong host is rejected, exit 1).

---

## Optional: repository variables

The workflow works with no setup because `.env.production` is committed. To point CI at a
different Supabase project, add **Settings → Secrets and variables → Actions → Variables**:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | your publishable key |

If you set neither, the build uses `.env.production`. Leave them unset rather than empty —
an empty variable would inline `""` over the working values.

---

## Verifying it took

```bash
gh run list --workflow=ci.yml --limit 3
```

Before installation this returns `404 Not Found`. After it, you get real runs.

---

## Also pending: `deploy.yml`

`deployment/workflows/deploy.yml` has a fix that is **not live** either, for the same
permission reason: the deployed copy still greps for one hard-coded project ref, so a build
using the override variables fails the deploy check even though the app is fine.

To apply it, paste `deployment/workflows/deploy.yml` over `.github/workflows/deploy.yml`
the same way. Until then, deploying with repository variables set will fail that step.
