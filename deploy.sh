#!/usr/bin/env bash
# =====================================================================
# deploy.sh — push the frontend to GitHub Pages.
# ---------------------------------------------------------------------
# Usage:   ./deploy.sh "optional commit message"
#
# What it does: stages every change, commits it, and pushes to the
# `origin` remote. GitHub Pages rebuilds automatically on push, so a
# few seconds after this finishes the live site is updated.
#
# This deploys the STATIC SITE only (index.html, styles.css, app.js,
# firebase-config.js, etc.). It does NOT deploy Cloud Functions — those
# change rarely and have their own command:
#     firebase deploy --only functions
# =====================================================================
set -euo pipefail

cd "$(dirname "$0")"

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
