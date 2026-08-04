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

const SLACK_BOT_TOKEN = defineSecret('SLACK_BOT_TOKEN');

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
