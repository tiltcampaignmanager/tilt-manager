# Clip Library — Handoff Prompt

_Paste this into a new Claude Code session to continue where we left off._

---

## Context

I'm building a **Clip Library** feature inside the Tilt Creative Tracker at `/Users/elsak/Claude/Tilt_Creative_Tracker`. The tracker is a vanilla-JS single-page app (17k-line `app.js`) served from GitHub Pages, with Firebase (Firestore + Cloud Functions) as the backend. Deploy is via `./deploy.sh` (add `--with-functions` when functions changed). Read `/Users/elsak/.claude/plans/seller-example-rstreetwear-typed-cookie.md` first — it's the full spec.

The Clip Library is a searchable index over Google Drive folders that hold raw video (b-roll mixed with talking heads, product shots, BTS). Files stay in Drive; the tracker holds per-clip **type / category / seller / product / freeform tags** plus thumbnails. It lives as a new **"Clips" tab** (admin + editor only) and has a new **"Clip Library" section in Config** for folder management.

## What's already built and deployed

Cloud Functions (`functions/index.js`):
- `syncDriveClips` — callable, walks the configured Drive folders (recursive), upserts each video file into `state/app/broll/{fileId}` — preserves user tags across syncs, marks vanished files `archived: true`, skips inaccessible folders and reports them via `walkErrors`
- `syncDriveClipsScheduled` — same, on cron `every day 03:00 Europe/London`
- `getBrollConfig` / `addBrollFolders` / `removeBrollFolder` — callables that read/write `config/broll` (needed because Firestore rules block client writes to `config/*`)

Client (`app.js`):
- New `clips` tab, wired in `TAB_DEFS`, `DEFAULT_TAB_ORDER`, `ROLE_TAB_VISIBILITY` (admin + editor only — NOT in `ALL_TABS` so catHead/contentLead don't inherit it)
- `renderClipsView()` — top-bar filters (search, type, category, seller, product, tagged-status), Sync-now button, thumbnail grid, right-side tag panel with preview + type buttons + category dropdown + seller/product combobox + freeform tag chips + notes textarea
- `Fb.subscribeBroll()` — real-time listener on `state/app/broll` subcollection
- `Fb.updateBrollTag()` / `Fb.updateBrollTagBulk()` — direct Firestore writes for tagging
- Config UI in `renderClipLibraryConfigBlock()` — bulk-paste textarea for folder links, numbered folder list, "8 folders couldn't be read" error box, seller/product list managers
- Keyboard shortcuts (Clips tab, no input focused): J/K = prev/next clip, 1–5 = set type, T/C/S/P = focus tag/category/seller/product fields
- Shift-click to bulk-select clips → bulk toolbar for type/category/seller

Styles (`styles.css`): grid, cards, pills, tag chips, config rows.

Deploy pipeline (`deploy.sh`): added `--with-functions` flag.

Setup completed (don't redo):
- Service account: `broll-sync@tilt-project-tracker.iam.gserviceaccount.com`
- Firebase secret `DRIVE_SERVICE_ACCOUNT_JSON` set from `~/Downloads/tilt-project-tracker-0e7a223e96de.json`
- Drive API enabled on project `tilt-project-tracker` (project number 339809998086)
- 29 folder IDs added to `config/broll.folderIds` via bulk-paste
- 21 of those 29 folders shared with the service account (Viewer role)
- First sync ran, wrote **1445 clips** to `state/app/broll` subcollection

## Current blocker — pick up here

The Clips tab shows **empty** even though 1445 clips are sitting in Firestore. Cause: Firestore security rules allow the Cloud Function (admin SDK) to write to `state/app/broll` but block the client SDK from reading it. `Fb.subscribeBroll()` silently errors.

Same rules issue also affects direct client writes to `state/app/broll/{id}` for tagging — those will also fail.

**Two paths to fix. Do path A.**

### Path A — Update Firestore rules

The current rules aren't in the repo (they were deployed via Firebase console, not `firebase deploy`). I need to see them before editing. Ask me to open **https://console.firebase.google.com/project/tilt-project-tracker/firestore/rules**, copy the whole `rules_version = '2'` block, and paste it back. Then give me the updated version that adds:

```
match /state/app/broll/{clip} {
  // Admin/editor role check via a users doc lookup, matching existing patterns
  allow read: if request.auth != null && request.auth.token.email.matches('.*@tilt[.]app$');
  allow write: if request.auth != null && request.auth.token.email.matches('.*@tilt[.]app$');
}
match /config/broll {
  allow read: if request.auth != null && request.auth.token.email.matches('.*@tilt[.]app$');
  // writes stay Cloud-Function-only
}
```

Adapt the exact predicate to whatever role-check pattern the existing rules use (they may check a `users/{uid}` doc for the role instead of just the email domain).

### Path B — Route reads/writes through Cloud Functions

If updating rules is too risky: add `getBrollClips` (returns the full subcollection), `updateBrollClipTag`, `updateBrollClipTagBulk` callables. Client calls `getBrollClips` on tab open + on sync-complete. Loses real-time cross-user updates on tagging — tolerable for MVP.

## Second thing to fix (after the blocker)

**8 folders failed the last sync** with "File not found" — the service account doesn't have access. Elsa opens each (Config → Clip Library shows the list with "Open ↗" links), right-clicks → Share → adds `broll-sync@tilt-project-tracker.iam.gserviceaccount.com` → Viewer → uncheck notify → Send. Hit Sync now again, error rows disappear.

Failed IDs (as of last sync):
```
1cPePcbBbK-ltqEzaDO3x-RmrHk5UXRhF
1L_c19Apnw0futIhfwTYNFg9pjl38KttB
1gAg33_BFKbMHjSvloWwoSuHOpvpPNqbL
1dhlsyACiw8x626S-XBoDTmfbBYQrPfcq
1WycAvuIGL5dnt1ywso0t38ghmhRh3byG
1oi75KvyoKe66_gNxIvTIzliPWaJrGaQ7
1xIwzF9_LwW2oPAwP8kYZVthAaOfi2ryc
10ZxRgboo_uiIi3AId7A0TEsIxymAQ9Ll
```

## After the blocker is fixed

1. Elsa tags first 100 clips solo — sanity checks the taxonomy (types: B-Roll / Talking Head / Product / BTS / Other; categories: reuse `DEFAULT_CATEGORIES`; sellers: seed with top 20; products: growing dropdown).
2. Editor sprint 1: Zidni/Sharm/Patty each tag 100 most recent clips from their own past campaigns (~30 min each).
3. Sprint 2: last 3 months of their campaigns (~2h each).
4. Ongoing: tagging becomes part of ad-wrap workflow.
5. Weekly QC pass by Elsa (filter `taggedBy = <editor>`, spot-check 20 random).

## Files modified (git log after `main`)

```
ca1e769 Raise Clip sync client timeout to 540s to match server
7d91fb9 Resilient Drive sync — skip inaccessible folders, surface them in Config
712eb37 Number Clip Library folder rows + show total count
77b76bb Route Clip Library config through Cloud Functions (Firestore rules gate)
8e4bf57 Add Clip Library — b-roll indexing over Google Drive
```

## Key gotchas discovered along the way (don't repeat)

- Firestore rules on this project restrict client access to `config/*` and probably to new `state/app/*` subcollections. Any new config path needs a Cloud Function proxy or a rules update.
- `firebase deploy --only functions` does NOT auto-enable Drive API even though `googleapis` is imported. Must `gcloud services enable drive.googleapis.com` manually. Elsa may need to `gcloud auth login` first (her firebase auth doesn't cover gcloud).
- Firebase JS SDK `httpsCallable` client-side default timeout is **70 seconds** — must override to match the server's timeout for long-running calls. Currently `syncDriveClips` uses `{ timeout: 540000 }` to match its 540s server timeout.
- Drive walk MUST be resilient to per-folder failures — one inaccessible folder should not abort the whole sync. Current implementation catches errors per-folder and returns them in `walkErrors`.
- Duplicate folder IDs in the bulk-paste get silently de-duped. The "Added N" toast reports the pre-dedup count.
- Elsa's Google account has Firebase-project access but NOT direct GCP Console access — anything requiring the GCP console needs to be done via CLI or by someone with owner-level access.
- v2 callables sometimes need `allUsers` Cloud Run invoker binding (per Elsa's earlier "Slack callable invoker fix" memory) — but this deployment worked without it, so watch for it as a symptom, not a proactive step.

## References

- Full spec / build plan: `/Users/elsak/.claude/plans/seller-example-rstreetwear-typed-cookie.md`
- Repo: https://gitlab.com/tiltcreativetracker/tilt-manager (mirrored to GitHub Pages)
- Firebase project: `tilt-project-tracker` (number 339809998086)
- Deployed tracker URL: https://tiltcreativetracker.github.io/tilt-manager/
- Preview auth bypass note: memory `preview-auth-bypass`
- Deploy quirk: memory `always-deploy-via-deploy-sh`
