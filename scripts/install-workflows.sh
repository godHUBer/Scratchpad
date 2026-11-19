#!/usr/bin/env bash
# Installs the GitHub Actions workflows into .github/workflows/.
#
# Why this exists: some automation tokens (including the GitHub App used to
# scaffold this repo) are allowed to push source files but explicitly denied the
# `workflows` permission by GitHub, so the two YAML files ship in
# deployment/workflows/ and must be copied into place by a human (or by a token
# that has `workflows: write`).
#
#   ./scripts/install-workflows.sh          # copy + show git commands
#   ./scripts/install-workflows.sh --commit # copy + commit (no push)
#
# Afterwards push, then enable Pages:
#   Settings → Pages → Build and deployment → Source: GitHub Actions
set -euo pipefail

cd "$(dirname "$0")/.."

src="deployment/workflows"
dest=".github/workflows"

if [[ ! -f "$src/ci.yml" || ! -f "$src/deploy.yml" ]]; then
  echo "error: expected $src/ci.yml and $src/deploy.yml" >&2
  exit 1
fi

mkdir -p "$dest"
cp "$src/ci.yml" "$dest/ci.yml"
cp "$src/deploy.yml" "$dest/deploy.yml"
echo "installed: $dest/ci.yml"
echo "installed: $dest/deploy.yml"

if [[ "${1:-}" == "--commit" ]]; then
  git add "$dest"
  git commit -m "ci: add lint/test/build and GitHub Pages deploy workflows"
  echo
  echo "committed. push with:  git push origin $(git rev-parse --abbrev-ref HEAD)"
else
  cat <<'EOF'

next:
  git add .github/workflows
  git commit -m "ci: add lint/test/build and GitHub Pages deploy workflows"
  git push origin <branch>

then enable Pages once (repo owner):
  Settings -> Pages -> Build and deployment -> Source: GitHub Actions

The deploy job runs on pushes to main. Open a PR from this branch and merge it,
or run the workflow manually with "workflow_dispatch" after merging.
EOF
fi
