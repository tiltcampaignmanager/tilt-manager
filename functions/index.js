// =====================================================================
// Cloud Functions for Tilt Creative Tracker
// ---------------------------------------------------------------------
// Purpose: keep the Slack bot token and Meta access token OFF the client.
// The browser calls these functions; the functions hold the tokens
// server-side and forward the request to Slack / Meta.
//
// Tokens are set via the Firebase CLI, not committed to git:
//   firebase functions:secrets:set SLACK_BOT_TOKEN
//   firebase functions:secrets:set META_ACCESS_TOKEN
//
// Auth: every function verifies the caller is a signed-in @tilt.app user.
// A random person hitting the endpoint gets rejected before any external
// API call happens.
// =====================================================================

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const SLACK_BOT_TOKEN   = defineSecret('SLACK_BOT_TOKEN');
const META_ACCESS_TOKEN = defineSecret('META_ACCESS_TOKEN');

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
    // Return the same shape the client code was expecting from postToSlackThread.
    return { ok: !!json.ok, body: json.error || (json.ok ? 'ok' : 'unknown'), status: res.status };
  }
);

// ── Meta: fetch ads across accounts ──────────────────────────────────
// Client passes { accountIds: ['1234', '5678'] }. Server fetches every page
// of ads for each account (following next-page cursors) and returns the
// aggregated list. Client does the matching against tracker assets — this
// function is purely the "hold the token + do the paginated fetch" piece.
exports.fetchMetaAds = onCall(
  { secrets: [META_ACCESS_TOKEN], region: 'us-central1', timeoutSeconds: 120 },
  async (request) => {
    requireTiltUser(request);

    const token = META_ACCESS_TOKEN.value();
    const accountIds = (request.data && request.data.accountIds) || [];
    if (!Array.isArray(accountIds) || accountIds.length === 0) {
      throw new HttpsError('invalid-argument', 'accountIds (array) required');
    }
    // Sanitize: strip act_ prefix, digits only.
    const cleanIds = accountIds
      .map((id) => String(id || '').trim().replace(/^act_/i, ''))
      .filter((id) => /^\d+$/.test(id));
    if (cleanIds.length === 0) {
      throw new HttpsError('invalid-argument', 'no valid numeric ad account IDs');
    }

    const apiBase = 'https://graph.facebook.com/v19.0';
    const fields = [
      'id', 'name', 'campaign_id', 'status', 'effective_status', 'updated_time',
      'campaign{id,name,status,effective_status,start_time,stop_time}',
      'creative{id,video_id,name,title}',
    ].join(',');

    const errors = [];

    async function fetchPage(url, accumulated) {
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) {
        errors.push(data.error.message || String(data.error));
        return accumulated;
      }
      const all = accumulated.concat(data.data || []);
      const next = data.paging && data.paging.next;
      return next ? fetchPage(next, all) : all;
    }

    async function fetchAllAdsForAccount(accountId) {
      const url = apiBase + '/act_' + accountId + '/ads' +
        '?fields=' + fields + '&limit=100&access_token=' + encodeURIComponent(token);
      try {
        return await fetchPage(url, []);
      } catch (err) {
        errors.push('act_' + accountId + ': ' + (err.message || String(err)));
        return [];
      }
    }

    const results = await Promise.all(cleanIds.map(fetchAllAdsForAccount));
    return { ads: results.flat(), errors };
  }
);

// ── Meta: batch-fetch activities for killed campaigns ────────────────
// Same reasoning as fetchMetaAds — token stays server-side. Client passes
// campaign IDs; server hits Meta's Batch API to grab activities in chunks
// of 50 and returns the merged results.
exports.fetchMetaActivities = onCall(
  { secrets: [META_ACCESS_TOKEN], region: 'us-central1', timeoutSeconds: 120 },
  async (request) => {
    requireTiltUser(request);

    const token = META_ACCESS_TOKEN.value();
    const campaignIds = (request.data && request.data.campaignIds) || [];
    if (!Array.isArray(campaignIds) || campaignIds.length === 0) {
      return { activities: {}, errors: [] };
    }

    const errors = [];
    const activitiesByCampaign = {}; // campaignId -> array of activity events

    async function runBatch(ids) {
      const batchReqs = ids.map((cid) => ({
        method: 'GET',
        relative_url: cid + '/activities?fields=event_type,event_time&limit=25',
      }));
      const body = new URLSearchParams({
        batch: JSON.stringify(batchReqs),
        access_token: token,
      });
      try {
        const res = await fetch('https://graph.facebook.com/v19.0', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
        const batchResults = await res.json();
        if (!Array.isArray(batchResults)) {
          errors.push('Unexpected batch response: ' + JSON.stringify(batchResults).slice(0, 200));
          return;
        }
        batchResults.forEach((result, idx) => {
          if (!result || result.code !== 200) return;
          try {
            const parsed = JSON.parse(result.body);
            activitiesByCampaign[ids[idx]] = parsed.data || [];
          } catch (e) {
            errors.push('parse error for ' + ids[idx]);
          }
        });
      } catch (err) {
        errors.push('Batch: ' + (err.message || String(err)));
      }
    }

    for (let i = 0; i < campaignIds.length; i += 50) {
      await runBatch(campaignIds.slice(i, i + 50));
    }

    return { activities: activitiesByCampaign, errors };
  }
);
