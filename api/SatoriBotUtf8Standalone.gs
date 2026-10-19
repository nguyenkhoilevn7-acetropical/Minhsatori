/**
 * Minh Satori / standalone HMAC UTF-8 self-test.
 *
 * Paste THIS FILE ONLY into a NEW, EMPTY Google Apps Script standalone project.
 * Never add it to the production Minh Satori Drive Sync project.
 * No DriveApp, PropertiesService, UrlFetchApp, web app deployment, or API secret.
 * The embedded key is a PUBLIC TEST FIXTURE — never use it in production.
 */
function satoriBotSandboxUtf8KnownAnswerTest() {
  'use strict';
  var secret = 'SANDBOX_ONLY_HMAC_UTF8_REFERENCE_KEY_123456789';
  var payload = {query:'Hà Minh Nguyệt – Ốc Q',limit:2};
  var expected = '97c4f5e3a9f147c53b9d6047056351cfb3f71287e50f0a635cbdfc7636085d3e';

  function sign(testPayload) {
    var canonical = [
      'bot_utf8_fixture',
      1792383152719,
      'utf8_fixture_nonce',
      'customers.search',
      JSON.stringify(testPayload)
    ].join('\n');
    return Utilities.computeHmacSha256Signature(canonical,secret,Utilities.Charset.UTF_8)
      .map(function(b){return ('0'+(b&255).toString(16)).slice(-2);}).join('');
  }

  var actual = sign(payload);
  if (actual !== expected) {
    throw new Error('FAIL: HMAC-SHA256 UTF-8 does not match the independently verified reference vector');
  }

  var changedPayload = {query:payload.query+'!',limit:2};
  var changed = sign(changedPayload);
  if (changed === expected) {
    throw new Error('FAIL: A modified Unicode message produced the same HMAC');
  }

  var result = {
    ok:true,
    checks:['UTF-8 HMAC known-answer','modified Vietnamese payload changes HMAC'],
    independentOfProduction:true,
    noDriveAccess:true,
    noProductionSecret:true
  };
  console.log('PASS: ' + JSON.stringify(result));
  return result;
}
