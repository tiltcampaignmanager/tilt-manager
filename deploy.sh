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

# 2. Anything to deploy?
if git diff --quiet && git diff --cached --quiet && [ -z "$(git status --porcelain)" ]; then
  echo "✓ Nothing to deploy — working tree is clean."
  exit 0
fi

# 3. Show what's going out.
echo "Changes to deploy:"
git status --short
echo

# 4. Commit message: use the argument, or a default with the date.
MSG="${1:-Update tracker ($(date '+%Y-%m-%d %H:%M'))}"

git add -A
git commit -m "$MSG"

# 5. Push to the current branch's upstream (or set it on first push).
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  git push
else
  git push -u origin "$BRANCH"
fi

echo
echo "✓ Pushed to origin/$BRANCH. GitHub Pages will rebuild in ~30s."
