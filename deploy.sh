#!/usr/bin/env bash
# =====================================================================
# deploy.sh — push the frontend to GitHub Pages.
# ---------------------------------------------------------------------
# Usage:
#   ./deploy.sh "optional commit message"
#   ./deploy.sh --with-functions "optional commit message"
#
# What it does: stages every change, commits it, and pushes to the
# `origin` remote. GitHub Pages rebuilds automatically on push, so a
# few seconds after this finishes the live site is updated.
#
# By default this deploys the STATIC SITE only (index.html, styles.css,
# app.js, firebase-config.js, etc.). Pass --with-functions to ALSO run
# `firebase deploy --only functions` after the git push — use this when
# you've edited anything in functions/.
# =====================================================================
set -euo pipefail

cd "$(dirname "$0")"

# Parse flags. --with-functions triggers a `firebase deploy --only functions`
# step after the git push. Everything else is treated as the commit message.
WITH_FUNCTIONS=0
COMMIT_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --with-functions|-f) WITH_FUNCTIONS=1 ;;
    *) COMMIT_ARGS+=("$arg") ;;
  esac
done
set -- "${COMMIT_ARGS[@]:-}"

# 1. Must be a git repo with a remote, or there's nowhere to push.
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "✗ Not a git repository. Run:  git init  and connect a remote first."
  exit 1
fi
if ! git remote get-url origin >/dev/null 2>&1; then
  echo "✗ No 'origin' remote. Connect one first, e.g.:"
  echo "    git remote add origin https://github.com/<you>/<repo>.git"
  exit 1
fi

# 1b. Cache-bust the asset references in index.html with each file's CONTENT HASH.
# GitHub Pages serves app.js/styles.css with a 10-minute cache and no way to set
# headers, so without this a deploy stays invisible until the browser cache expires
# (or a manual hard-refresh). Stamping "?v=<hash>" gives changed files a brand-new
# URL the browser has never cached — so updates show up immediately — while
# UNCHANGED files keep the same hash and stay cached. Runs before the change check
# so a real edit to app.js/styles.css is picked up as an index.html change to deploy.
if command -v git >/dev/null 2>&1; then
  APP_VER="$(git hash-object app.js | cut -c1-8)"
  CSS_VER="$(git hash-object styles.css | cut -c1-8)"
  perl -pi -e "s/(app\.js\?v=)[\w.\-]+/\${1}$APP_VER/g; s/(styles\.css\?v=)[\w.\-]+/\${1}$CSS_VER/g" index.html
  echo "Stamped index.html → app.js?v=$APP_VER · styles.css?v=$CSS_VER"
fi

# 2. Is there anything to deploy? Two cases count:
#    (a) uncommitted changes in the working tree, or
#    (b) a clean tree but local commits not yet pushed to origin.
HAS_CHANGES=0
if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git status --porcelain)" ]; then
  HAS_CHANGES=1
fi
UNPUSHED=0
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  # Upstream exists — count commits ahead of it.
  [ "$(git rev-list --count '@{u}'..HEAD)" -gt 0 ] && UNPUSHED=1
else
  # No upstream yet — any local commit needs a first push.
  git rev-parse HEAD >/dev/null 2>&1 && UNPUSHED=1
fi
if [ "$HAS_CHANGES" -eq 0 ] && [ "$UNPUSHED" -eq 0 ]; then
  echo "✓ Nothing to deploy — tree is clean and origin is up to date."
  exit 0
fi

# 3. Commit any uncommitted work (skip if the tree is already clean).
if [ "$HAS_CHANGES" -eq 1 ]; then
  echo "Changes to commit:"
  git status --short
  echo
  MSG="${1:-Update tracker ($(date '+%Y-%m-%d %H:%M'))}"
  git add -A
  git commit -m "$MSG"
else
  echo "No new changes — pushing existing commit(s)."
fi

# 5. Push to the current branch's upstream (or set it on first push).
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  git push
else
  git push -u origin "$BRANCH"
fi

echo
echo "✓ Pushed to origin/$BRANCH. GitHub Pages will rebuild in ~30s."

# Optional: also deploy Cloud Functions (kept behind a flag so a normal
# frontend deploy doesn't wait ~2 minutes for the functions bundle to upload).
if [ "$WITH_FUNCTIONS" -eq 1 ]; then
  if ! command -v firebase >/dev/null 2>&1; then
    echo "✗ --with-functions passed but 'firebase' CLI not found. Install it with:  npm i -g firebase-tools"
    exit 1
  fi
  echo
  echo "Deploying Cloud Functions…"
  firebase deploy --only functions
  echo "✓ Cloud Functions deployed."
fi
