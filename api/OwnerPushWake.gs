/**
 * Minh Satori — Owner push WAKE trigger (optional, owner-installed).
 *
 * WHY: Render Free sleeps after ~15 min idle, so the V2 push relay cannot scan
 * the ledger while asleep. Orders written by Gemini / ChatGPT / other official
 * writers go through this Apps Script, not through Render.
 *
 * WHAT: a 1-minute TIME-DRIVEN trigger. It never runs inside an order write, so
 * Gemini/ChatGPT/Website order latency and the write lock are untouched.
 * It reads only the ledger file's Drive "last updated" metadata; when it
 * changed, it POSTs a signed, data-free wake request to the V2 service. The V2
 * relay then re-reads the signed ledger and sends exactly one FCM per invoice.
 * No invoice number, customer, amount or token is sent.
 *
 * SETUP (Apps Script > Project Settings > Script properties):
 *   SATORI_OWNER_PUSH_WAKE_URL    = https://<v2-service>/api/v2/push/wake
 *   SATORI_OWNER_PUSH_WAKE_SECRET = same random value (>= 32 chars) as the
 *                                   Render secret SATORI_OWNER_PUSH_WAKE_SECRET
 *   STATE_FILE_ID                 = (already present for BotApi.gs)
 * Then run installOwnerPushWakeTrigger() once from the editor.
 *
 * Latency: trigger <= ~1 min + Render cold start (~30-60 s) + FCM. This is
 * near-real-time, NOT instant, for orders created outside Render.
 */
var OWNER_PUSH_WAKE_LAST = 'SATORI_OWNER_PUSH_WAKE_LAST';

function ownerPushWakeSignature_(secret, ts, nonce, changedAt) {
  var bytes = Utilities.computeHmacSha256Signature(
    ts + '\n' + nonce + '\n' + changedAt, secret, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function ownerPushWakeTick() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty('SATORI_OWNER_PUSH_WAKE_URL') || '');
  var secret = String(props.getProperty('SATORI_OWNER_PUSH_WAKE_SECRET') || '');
  var fileId = String(props.getProperty('STATE_FILE_ID') || '');
  if (!/^https:\/\/[A-Za-z0-9.-]+\/api\/v2\/push\/wake$/.test(url) ||
      secret.length < 32 || !fileId) return 'WAKE_NOT_CONFIGURED';
  var changedAt = DriveApp.getFileById(fileId).getLastUpdated().getTime();
  var last = Number(props.getProperty(OWNER_PUSH_WAKE_LAST) || 0);
  if (changedAt <= last) return 'NO_CHANGE';
  var ts = Date.now();
  var nonce = Utilities.getUuid().replace(/-/g, '').toLowerCase();
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ ts: ts, nonce: nonce, changedAt: changedAt }),
    headers: { 'x-satori-wake-signature': ownerPushWakeSignature_(secret, ts, nonce, changedAt) },
    muteHttpExceptions: true,
    followRedirects: false
  });
  var code = response.getResponseCode();
  // Only a confirmed 202 advances the marker; otherwise retry next minute.
  if (code === 202) props.setProperty(OWNER_PUSH_WAKE_LAST, String(changedAt));
  return 'HTTP_' + code;
}

function installOwnerPushWakeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'ownerPushWakeTick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('ownerPushWakeTick').timeBased().everyMinutes(1).create();
  return 'INSTALLED';
}

function removeOwnerPushWakeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'ownerPushWakeTick') ScriptApp.deleteTrigger(t);
  });
  return 'REMOVED';
}
