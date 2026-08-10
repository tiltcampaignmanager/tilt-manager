// =====================================================================
// Cloud Functions for Tilt Creative Tracker
// ---------------------------------------------------------------------
// Purpose: keep the Slack bot token (and later the Meta access token) OFF
// the client. The browser calls these functions; the functions hold the
// tokens server-side and forward the request to Slack / Meta.
//
// Tokens are set via the Firebase CLI, not committed to git:
//   firebase functions:secrets:set SLACK_BOT_TOKEN
//
// Auth: every function verifies the caller is a signed-in @tilt.app user.
//
// META NOTE: the Meta sync functions (fetchMetaAds / fetchMetaActivities)
// are intentionally NOT included yet — Meta sync isn't in use. To add them,
// set the secret (firebase functions:secrets:set META_ACCESS_TOKEN) and
// paste back the two `onCall` blocks from this session (they call the Meta
// Graph API server-side, same auth gate as below), then redeploy.
// =====================================================================

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const SLACK_BOT_TOKEN = defineSecret('SLACK_BOT_TOKEN');
const LINEAR_API_KEY = defineSecret('LINEAR_API_KEY');

const ALLOWED_DOMAIN = 'tilt.app';

// Reject any call from a user who isn't signed in with @tilt.app.
function requireTiltUser(request) {
  const email = request.auth && request.auth.token && request.auth.token.email;
  if (!email || !email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN)) {
    throw new HttpsError('permission-denied', 'Only @' + ALLOWED_DOMAIN + ' users may call this function.');
  }
}

// ── Slack: post as a bot ─────────────────────────────────────────────
// Client calls this instead of doing chat.postMessage itself. Client passes
// { channel, threadTs, text }; server adds the bot token and posts.
exports.sendSlackChatPostMessage = onCall(
  { secrets: [SLACK_BOT_TOKEN], region: 'us-central1' },
  async (request) => {
    requireTiltUser(request);

    const { channel, threadTs, text } = request.data || {};
    if (!channel || !text) {
      throw new HttpsError('invalid-argument', 'channel and text are required');
    }

    const body = new URLSearchParams({
      token: SLACK_BOT_TOKEN.value(),
      channel: String(channel),
      text: String(text),
      unfurl_links: 'false',
      unfurl_media: 'false',
    });
    if (threadTs) {
      body.set('thread_ts', String(threadTs));
      body.set('reply_broadcast', 'false');
    }

    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const json = await res.json();
    // Return the same shape the client's postToSlackThread expects.
    return { ok: !!json.ok, body: json.error || (json.ok ? 'ok' : 'unknown'), status: res.status };
  }
);

// ── Slack: DM a scorecard image to an editor ─────────────────────────
// Client calls with { editorSlackId, imageBase64, filename?, initialComment? }.
// Server opens a DM with the editor and uploads the image via the v2 file API
// (files.upload was deprecated Mar 2025). Three steps: getUploadURLExternal →
// POST bytes → completeUploadExternal with the DM channel_id.
exports.sendSlackScorecardDm = onCall(
  { secrets: [SLACK_BOT_TOKEN], region: 'us-central1', timeoutSeconds: 60, memory: '512MiB' },
  async (request) => {
    requireTiltUser(request);

    const { editorSlackId, imageBase64, filename, initialComment } = request.data || {};
    if (!editorSlackId || !imageBase64) {
      throw new HttpsError('invalid-argument', 'editorSlackId and imageBase64 are required');
    }
    const token = SLACK_BOT_TOKEN.value();
    const authHeader = 'Bearer ' + token;

    // 1. Open a DM with the editor.
    const openRes = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: authHeader },
      body: new URLSearchParams({ users: String(editorSlackId) }).toString(),
    });
    const openJson = await openRes.json();
    if (!openJson.ok) {
      return { ok: false, body: 'conversations.open failed: ' + (openJson.error || 'unknown') };
    }
    const channelId = openJson.channel.id;

    // 2. Reserve an upload URL for the image.
    const buffer = Buffer.from(imageBase64, 'base64');
    const uploadFilename = filename || 'scorecard.png';
    const getUrlRes = await fetch('https://slack.com/api/files.getUploadURLExternal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: authHeader },
      body: new URLSearchParams({ filename: uploadFilename, length: String(buffer.length) }).toString(),
    });
    const getUrlJson = await getUrlRes.json();
    if (!getUrlJson.ok) {
      return { ok: false, body: 'getUploadURLExternal failed: ' + (getUrlJson.error || 'unknown') };
    }
    const { upload_url: uploadUrl, file_id: fileId } = getUrlJson;

    // 3. POST the raw file bytes to the reserved URL.
    const putRes = await fetch(uploadUrl, { method: 'POST', body: buffer });
    if (!putRes.ok) {
      return { ok: false, body: 'file upload POST failed: ' + putRes.status };
    }

    // 4. Complete the upload and share it into the editor's DM.
    const completePayload = {
      files: [{ id: fileId, title: uploadFilename }],
      channel_id: channelId,
    };
    if (initialComment) completePayload.initial_comment = String(initialComment);
    const completeRes = await fetch('https://slack.com/api/files.completeUploadExternal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify(completePayload),
    });
    const completeJson = await completeRes.json();
    if (!completeJson.ok) {
      return { ok: false, body: 'completeUploadExternal failed: ' + (completeJson.error || 'unknown') };
    }

    return { ok: true, body: 'ok', channel: channelId, fileId: fileId };
  }
);

// ── Linear: push completed campaigns as issues ───────────────────────
// Client clicks a button; server reads Firestore state, computes each
// completed campaign's KPI + a team-wide snapshot, and creates (or
// updates, if already pushed) one Linear issue per completed campaign.
// Config lives in Firestore config/linear = { teamKey, projectId }.
// Push history lives in state/app/linearPushes/{campaignId} so we
// never race the main state/app doc.
exports.pushCompletedCampaignsToLinear = onCall(
  { secrets: [LINEAR_API_KEY], region: 'us-central1', timeoutSeconds: 120, memory: '512MiB' },
  async (request) => {
    requireTiltUser(request);

    // Reporting filter passed from the client (Reporting tab's current selection).
    // Falls back to "no filter" — pushes every completed campaign.
    const filter = (request.data && request.data.filter) || {};
    const range = filter.range && filter.range.start && filter.range.end ? filter.range : null;
    const wantCountry  = filter.country  && filter.country  !== 'all' ? filter.country  : null;
    const wantType     = filter.type     && filter.type     !== 'all' ? filter.type     : null;
    const wantCategory = filter.category && filter.category !== 'all' ? filter.category : null;

    // 1. Load config.
    const cfgSnap = await db.doc('config/linear').get();
    if (!cfgSnap.exists) {
      throw new HttpsError('failed-precondition', 'config/linear document is missing. Create it with { teamKey, projectId }.');
    }
    const cfg = cfgSnap.data() || {};
    const teamKey = cfg.teamKey;
    const projectId = cfg.projectId || null;
    const assigneeEmail = cfg.assigneeEmail || 'elsa@tilt.app';
    if (!teamKey) {
      throw new HttpsError('failed-precondition', 'config/linear.teamKey is required.');
    }

    // 2. Resolve team key → team id (Linear needs the id, not the key).
    const teamId = await linearGetTeamId(teamKey);

    // 2b. Resolve projectId. Accepts a full UUID, the URL-slug tail
    // (the last 12 hex chars Linear appends to `.../project/name-<hex>`),
    // or a project name — resolves to a real UUID by searching every
    // project in the workspace. Fails loudly with the available project
    // names so the config error is diagnosable.
    const resolvedProject = projectId ? await linearResolveProject(teamId, projectId) : null;
    const resolvedProjectId = resolvedProject ? resolvedProject.id : null;
    console.log('[Linear] Config projectId:', JSON.stringify(projectId), '→ resolved:', JSON.stringify(resolvedProject));

    // 2c. Resolve assignee email → Linear user id (once per invocation).
    const assigneeId = assigneeEmail ? await linearResolveUserId(assigneeEmail) : null;
    console.log('[Linear] Assignee:', assigneeEmail, '→', assigneeId);

    // 3. Load workspace state + assets subcollection + existing push history.
    const [stateSnap, assetsSnap, pushesSnap] = await Promise.all([
      db.doc('state/app').get(),
      db.collection('state/app/assets').get(),
      db.collection('state/app/linearPushes').get(),
    ]);
    if (!stateSnap.exists) {
      throw new HttpsError('failed-precondition', 'state/app document is missing.');
    }
    const state = stateSnap.data() || {};
    const campaigns = Array.isArray(state.campaigns) ? state.campaigns : [];
    const grades = Array.isArray(state.grades) ? state.grades : [];
    const scorecardMeta = state.scorecardMeta || {};
    const assets = [];
    assetsSnap.forEach((d) => assets.push(d.data()));
    const pushes = {};
    pushesSnap.forEach((d) => { pushes[d.id] = d.data(); });

    // 4. Determine completed campaigns (c.done OR every non-cancelled asset Approved).
    // Same signal as the Reporting tab (app.js:10238).
    const SIMPLE = new Set(['IT', 'ES', 'PL']);
    const campAssets = (cid) => assets.filter((a) => String(a.campaignId) === String(cid));
    const isCompleted = (c) => {
      if (c.done) return true;
      const active = campAssets(c.id).filter((a) => a.status !== 'Cancelled' && a.categoryHeadQc !== 'Cancelled');
      if (active.length === 0) return false;
      return active.every((a) => SIMPLE.has(c.country) ? a.status === 'Approved' : a.categoryHeadQc === 'Approved');
    };
    // Finish date = latest dateApproved across the campaign's assets. Used
    // for both the title's Month token and the reporting-period filter.
    const finishOf = (c) => campAssets(c.id).reduce((max, a) => (a.dateApproved && a.dateApproved > max) ? a.dateApproved : max, '');
    // Apply the Reporting tab's filters. finishDate within [range.start, range.end]
    // (inclusive), plus country / type / category — mirrors the client's Reporting UI.
    const inRange = (iso) => !range || (iso && iso >= range.start && iso <= range.end);
    const matchesFilter = (c) => {
      if (wantCountry  && c.country !== wantCountry) return false;
      if (wantType     && (c.type || 'Paid Ads') !== wantType) return false;
      if (wantCategory && (c.category || 'Uncategorised') !== wantCategory) return false;
      return inRange(finishOf(c));
    };
    const completed = campaigns.filter((c) => isCompleted(c) && matchesFilter(c));

    // 5. Compute team snapshot (current month, pooled across all editors).
    const teamSnapshot = computeTeamMetrics(grades, assets, scorecardMeta);

    // 6. Push each completed campaign — parallel with a concurrency cap so
    // 100+ campaigns don't serialise into a 60s+ callable timeout, while
    // staying under Linear's per-second burst limits.
    const created = [];
    const updated = [];
    const errors = [];
    const CONCURRENCY = 8;
    async function pushOne(c) {
      try {
        const campMetrics = computeCampaignMetrics(c, campAssets(c.id), grades);
        const title = buildIssueTitle(c, finishOf(c));
        const body = buildIssueBody(c, campAssets(c.id), campMetrics, teamSnapshot);
        const existing = pushes[String(c.id)];
        if (existing && existing.issueId) {
          await linearUpdateIssue(existing.issueId, { title, description: body, projectId: resolvedProjectId, assigneeId });
          await db.doc('state/app/linearPushes/' + String(c.id)).set({
            issueId: existing.issueId,
            url: existing.url || null,
            pushedAt: admin.firestore.FieldValue.serverTimestamp(),
            title, campaignId: String(c.id),
          }, { merge: true });
          updated.push({ campaignId: c.id, issueId: existing.issueId });
        } else {
          const res = await linearCreateIssue({ teamId, projectId: resolvedProjectId, title, description: body, assigneeId });
          await db.doc('state/app/linearPushes/' + String(c.id)).set({
            issueId: res.id,
            url: res.url,
            identifier: res.identifier,
            pushedAt: admin.firestore.FieldValue.serverTimestamp(),
            title, campaignId: String(c.id),
          });
          created.push({ campaignId: c.id, issueId: res.id, url: res.url, identifier: res.identifier });
        }
      } catch (e) {
        errors.push({ campaignId: c.id, name: c.name, error: (e && e.message) || String(e) });
      }
    }
    for (let i = 0; i < completed.length; i += CONCURRENCY) {
      await Promise.all(completed.slice(i, i + CONCURRENCY).map(pushOne));
    }

    return {
      ok: errors.length === 0,
      created: created.length,
      updated: updated.length,
      skipped: campaigns.length - completed.length,
      completedTotal: completed.length,
      project: resolvedProject,
      errors,
      details: { created, updated },
    };
  }
);

// ─── Linear GraphQL helpers ──────────────────────────────────────────

async function linearGraphQL(query, variables) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: LINEAR_API_KEY.value(),
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors && json.errors.length) {
    // Surface field-level detail (Linear tucks it into extensions.userPresentableMessage
    // or extensions.errors[]) so config bugs don't just say "Argument Validation Error".
    const parts = json.errors.map((e) => {
      const ext = e.extensions || {};
      const detail = ext.userPresentableMessage || (Array.isArray(ext.errors) && ext.errors.map((x) => x.message || JSON.stringify(x)).join(', '));
      return detail && detail !== e.message ? (e.message + ' — ' + detail) : e.message;
    });
    throw new Error('Linear API: ' + parts.join('; '));
  }
  return json.data;
}

// Linear project IDs are UUIDs. Users often paste the URL-slug tail
// (last 12 hex chars, no hyphens) or the project name instead. Resolve
// any of those to the real UUID by listing ALL workspace projects (not
// just team.projects — projects can be workspace-scoped and still valid
// on the team). Returns { id, name } or throws with the projects seen.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function linearResolveProject(teamId, raw) {
  const value = String(raw).trim();
  const data = await linearGraphQL(
    'query{ projects(first:250, includeArchived:false){ nodes{ id name teams{ nodes{ id } } } } }',
    {}
  );
  const nodes = (data && data.projects && data.projects.nodes) || [];
  // If a full UUID was given, look it up directly (returns name for logging).
  if (UUID_RE.test(value)) {
    const byId = nodes.find((p) => String(p.id).toLowerCase() === value.toLowerCase());
    return byId || { id: value, name: '(unknown — UUID not in workspace listing)' };
  }
  const lower = value.toLowerCase();
  // Match by name (case-insensitive), then by URL-slug tail (id ends with the value).
  const byName = nodes.find((p) => String(p.name || '').toLowerCase() === lower);
  if (byName) return { id: byName.id, name: byName.name };
  const byTail = nodes.find((p) => String(p.id).replace(/-/g, '').toLowerCase().endsWith(lower.replace(/-/g, '')));
  if (byTail) return { id: byTail.id, name: byTail.name };
  const sample = nodes.slice(0, 20).map((p) => p.name + ' (' + p.id + ')').join(', ');
  throw new Error('config/linear.projectId "' + value + '" did not match any project in the workspace. Paste the full UUID or the project name. Workspace projects: ' + (sample || 'none'));
}

async function linearGetTeamId(teamKey) {
  const data = await linearGraphQL(
    'query($key:String!){ teams(filter:{key:{eq:$key}}){ nodes{ id key name } } }',
    { key: String(teamKey).toUpperCase() }
  );
  const node = data && data.teams && data.teams.nodes && data.teams.nodes[0];
  if (!node) throw new Error('Linear team not found for key "' + teamKey + '".');
  return node.id;
}

async function linearCreateIssue({ teamId, projectId, title, description, assigneeId }) {
  const input = { teamId, title, description };
  if (projectId) input.projectId = projectId;
  if (assigneeId) input.assigneeId = assigneeId;
  const data = await linearGraphQL(
    'mutation($input:IssueCreateInput!){ issueCreate(input:$input){ success issue{ id identifier url } } }',
    { input }
  );
  if (!data.issueCreate || !data.issueCreate.success) {
    throw new Error('Linear issueCreate returned success=false.');
  }
  return data.issueCreate.issue;
}

async function linearUpdateIssue(issueId, { title, description, projectId, assigneeId }) {
  const input = { title, description };
  if (projectId) input.projectId = projectId;
  if (assigneeId) input.assigneeId = assigneeId;
  const data = await linearGraphQL(
    'mutation($id:String!,$input:IssueUpdateInput!){ issueUpdate(id:$id,input:$input){ success } }',
    { id: issueId, input }
  );
  if (!data.issueUpdate || !data.issueUpdate.success) {
    throw new Error('Linear issueUpdate returned success=false.');
  }
}

// Resolve a workspace-member email to a Linear user id (used for assignee).
// Falls back to null if not found — the caller then omits the field.
async function linearResolveUserId(email) {
  const data = await linearGraphQL(
    'query($email:String!){ users(filter:{email:{eq:$email}}){ nodes{ id email } } }',
    { email: String(email).trim().toLowerCase() }
  );
  const nodes = (data && data.users && data.users.nodes) || [];
  return nodes[0] ? nodes[0].id : null;
}

// Title template: "Creative Production | <Category> - <Campaign Name> | <Month YYYY>".
// Month is derived from the campaign's finish date (latest asset approval),
// so re-pushes reflect the actual completion month even if the campaign
// name doesn't spell it out.
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function buildIssueTitle(c, finishDate) {
  const cat  = c.category || 'Uncategorised';
  const name = c.name || 'Untitled';
  const iso  = finishDate || '';
  let monthLbl = '';
  if (/^\d{4}-\d{2}/.test(iso)) {
    const yr = iso.slice(0, 4);
    const mi = parseInt(iso.slice(5, 7), 10) - 1;
    if (mi >= 0 && mi < 12) monthLbl = MONTH_NAMES[mi] + ' ' + yr;
  }
  return 'Creative Production | ' + cat + ' - ' + name + (monthLbl ? ' | ' + monthLbl : '');
}

// ─── KPI metric helpers (server port of app.js:7272 / :7323, restricted
// to the five raw metrics the user asked for) ────────────────────────

// Revision-round cap by content type (Net New ≤ 4, Maintenance ≤ 2).
// Mirrors gradeWithinCap in app.js:7165.
function gradeWithinCap(g) {
  const cap = String(g && g.contentType || '').toLowerCase() === 'maintenance' ? 2 : 4;
  const r = Number(g && g.revisionRounds) || 0;
  return r <= cap;
}

function pctRate(num, den) { return den > 0 ? (num / den * 100) : 0; }

function meanRevisionRounds(rows) {
  if (!rows.length) return null;
  const s = rows.reduce((acc, g) => acc + (Number(g.revisionRounds) || 0), 0);
  return s / rows.length;
}

function ymOf(dateStr) { return (dateStr || '').slice(0, 7); }

// Team snapshot: current calendar month, pooled across editors' grades.
function computeTeamMetrics(grades, assets, scorecardMeta) {
  const now = new Date();
  const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const monthGrades = grades.filter((g) => ymOf(g.date) === ym && !g.dismissed);
  const editors = Array.from(new Set(monthGrades.map((g) => g.editor).filter(Boolean)));

  const total = monthGrades.length;
  const qaN = monthGrades.filter((g) => g.qaClean).length;
  const brandN = monthGrades.filter((g) => g.brandPass).length;
  const ideasN = monthGrades.filter((g) => g.newIdea).length;

  // Team Avg output per day: video-weighted mean of per-editor avgVideosPerDay.
  // Editors without a set avgVideosPerDay drop out of the denominator.
  let outNum = 0, outDen = 0;
  editors.forEach((ed) => {
    const meta = scorecardMeta[ed] || {};
    const v = (meta.avgVideosPerDay === '' || meta.avgVideosPerDay == null) ? null : Number(meta.avgVideosPerDay);
    if (v == null || isNaN(v)) return;
    const w = monthGrades.filter((g) => g.editor === ed).length;
    outNum += v * w;
    outDen += w;
  });
  const avgPerDay = outDen > 0 ? outNum / outDen : null;

  return {
    ym,
    total,
    qaRate: pctRate(qaN, total),
    brandRate: pctRate(brandN, total),
    innovationRate: pctRate(ideasN, total),
    avgPerDay,
    avgRevisionRounds: meanRevisionRounds(monthGrades),
    editors,
    withinCapRate: pctRate(monthGrades.filter(gradeWithinCap).length, total),
  };
}

// Per-campaign metrics: all grades linked to this campaign's assets, no date filter.
function computeCampaignMetrics(campaign, campaignAssets, grades) {
  const assetIds = new Set(campaignAssets.map((a) => String(a.id)));
  const rows = grades.filter((g) => assetIds.has(String(g.assetId)) && !g.dismissed);
  const total = rows.length;
  const qaN = rows.filter((g) => g.qaClean).length;
  const brandN = rows.filter((g) => g.brandPass).length;
  const ideasN = rows.filter((g) => g.newIdea).length;
  const revisionRounds = campaignAssets.map((a) => Number(a.revisionRounds) || 0);
  const avgRounds = revisionRounds.length ? revisionRounds.reduce((s, x) => s + x, 0) / revisionRounds.length : null;
  return {
    total,
    qaRate: pctRate(qaN, total),
    brandRate: pctRate(brandN, total),
    innovationRate: pctRate(ideasN, total),
    avgRevisionRounds: avgRounds,
    editors: Array.from(new Set(campaignAssets.map((a) => a.editor).filter(Boolean))),
    assetCount: campaignAssets.length,
    approvedCount: campaignAssets.filter((a) => a.status === 'Approved').length,
  };
}

function fmtPct(v) { return v == null ? '—' : (Math.round(v * 10) / 10) + '%'; }
function fmtNum(v, digits) { if (v == null) return '—'; const p = Math.pow(10, digits || 1); return String(Math.round(v * p) / p); }

function buildIssueBody(c, campaignAssets, camp, team) {
  const finishDate = campaignAssets.reduce((max, a) => (a.dateApproved && a.dateApproved > max) ? a.dateApproved : max, '');
  const editorsList = camp.editors.length ? camp.editors.join(', ') : '—';
  return [
    '## Campaign',
    '- **Country:** ' + (c.country || '—'),
    '- **Category:** ' + (c.category || '—'),
    '- **Type:** ' + (c.type || '—'),
    '- **Editors:** ' + editorsList,
    '- **Assets:** ' + camp.approvedCount + ' approved / ' + camp.assetCount + ' total',
    finishDate ? '- **Completed:** ' + finishDate : '',
    '',
    '## This campaign\'s KPI',
    'Across the campaign\'s ' + camp.total + ' graded asset(s):',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    '| QA | ' + fmtPct(camp.qaRate) + ' |',
    '| Brand | ' + fmtPct(camp.brandRate) + ' |',
    '| Innovation | ' + fmtPct(camp.innovationRate) + ' |',
    '| Speed — Avg revision rounds | ' + fmtNum(camp.avgRevisionRounds, 2) + ' |',
    '',
    '## Team snapshot (' + team.ym + ')',
    'Pooled across ' + team.editors.length + ' editor(s), ' + team.total + ' graded asset(s) this month.',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    '| QA | ' + fmtPct(team.qaRate) + ' |',
    '| Brand | ' + fmtPct(team.brandRate) + ' |',
    '| Innovation | ' + fmtPct(team.innovationRate) + ' |',
    '| Speed — Avg output per day | ' + fmtNum(team.avgPerDay, 2) + ' |',
    '| Speed — Avg revision rounds | ' + fmtNum(team.avgRevisionRounds, 2) + ' |',
    '',
    '_Auto-generated by the Tilt Creative Tracker._',
  ].filter(Boolean).join('\n');
}
