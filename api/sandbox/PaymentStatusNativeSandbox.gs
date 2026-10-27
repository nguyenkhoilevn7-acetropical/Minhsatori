/*
 * Minh Satori — NATIVE Apps Script + REAL FAKE DRIVE payment test.
 * This file must be loaded ONLY by an explicit owner action inside
 * MinhSatori_Bot_Write_Sandbox_ONLY.
 *
 * It creates a NEW fake Drive file, injects strict Drive/Properties guards,
 * evaluates pinned public BotApi source in a private function scope,
 * performs signed HMAC calls, then restores the original fake bytes.
 * Never install on the V18.3 production project. Never deploy this script.
 *
 * API version pinned to Git commit that merged PR #187.
 * No user/customer data, credentials or live Drive state file IDs.
 */
function paymentStatusNativeSandbox20261027() {
  'use strict';
  if (typeof runSatoriWriteSandboxOnly !== 'function' ||
      typeof satoriBotSandboxUtf8KnownAnswerTest !== 'function') {
    throw new Error('WRONG_PROJECT: Only existing MinhSatori_Bot_Write_Sandbox_ONLY');
  }
  const pinnedApi =
    'https://raw.githubusercontent.com/nguyenkhoilevn7-acetropical/Minhsatori/' +
    '39b63f46e8c4ec76365db00abb0fcdae97f4cb6b/api/BotApi.gs';
  const reply = UrlFetchApp.fetch(pinnedApi, {muteHttpExceptions: true});
  if (reply.getResponseCode() !== 200) throw new Error('API_SOURCE_UNAVAILABLE');
  const source = reply.getContentText('UTF-8');
  for (const phrase of ['var SatoriBotApi=', 'function changePaymentFlag(',
    'payments.markSatoriPaid', 'payments.markSatoriUnpaid',
    'payments.markCustomerUnpaid']) {
    if (!source.includes(phrase)) throw new Error('UNEXPECTED_SOURCE: ' + phrase);
  }

  const folder = DriveApp.createFolder('MinhSatori_PAYMENT_NATIVE_SANDBOX_ONLY_' +
    Utilities.getUuid());
  const testRows = [
    {id: 'fixture-A', invoiceNo: 70001, name: 'Khách giả lập Nguyễn',
      total: 125000, status: 'Chưa thanh toán'},
    {id: 'fixture-B', invoiceNo: 70001, name: 'Khách giả lập B',
      total: 250000, status: 'Chưa thanh toán'}
  ];
  const seed = JSON.stringify({
    revision: 1, updatedAt: '2026-10-27T00:00:00.000Z',
    values: {satori_orders_v15: JSON.stringify(testRows),
      satori_trash_bin_v15: '[]', satori_deleted_invoice_nos: '[]'}
  });
  const fakeFile = folder.createFile('PAYMENT_FAKE_INVOICES_ONLY.json',
    seed, MimeType.PLAIN_TEXT);
  const backupIds = [], checks = [], cache = {}, secret =
    Utilities.getUuid() + Utilities.getUuid();
  const client = {enabled: true, secret: secret,
    scopes: ['orders:read', 'payments:write']};
  let problem = null;
  let observedBeforeRestore = null;
  let restoredExactly = false;

  function readStateOnlyFake() {
    return JSON.parse(fakeFile.getBlob().getDataAsString());
  }
  // Explicit deny-list-by-default: no real Drive IDs can reach BotApi.
  const guardedDrive = {
    getFileById: function(id) {
      if (id !== fakeFile.getId()) throw new Error('PRODUCTION_DRIVE_BLOCKED');
      return {
        getId: function() {return fakeFile.getId();},
        getBlob: function() {return fakeFile.getBlob();},
        setContent: function(content) {fakeFile.setContent(content);},
        makeCopy: function(name) {
          const copy = fakeFile.makeCopy('SANDBOX_ONLY_' + name, folder);
          backupIds.push(copy.getId());
          return {getId: function() {return copy.getId();},
            getBlob: function() {return copy.getBlob();}};
        }
      };
    }
  };
  const isolatedProperties = {
    getScriptProperties: function() {return {
      getProperty: function(name) {
        if (name === 'STATE_FILE_ID') return fakeFile.getId();
        if (name === 'SATORI_BOT_CLIENTS_JSON')
          return JSON.stringify({'fixture-native': client});
        return null;
      }
    };}
  };
  const isolatedCache = {getScriptCache: function() {return {
    get: function(k) {return cache[k] || null;},
    put: function(k, v) {cache[k] = v;}
  };}};
  const isolatedLock = {getScriptLock: function() {return {
    waitLock: function() {}, releaseLock: function() {}
  };}};

  function expect(ok, label) {
    if (!ok) throw new Error('FAIL ' + label);
    checks.push(label);
    console.log('PASS ' + label);
  }
  function signedCall(handle, action, payload) {
    const envelope = {
      keyId: 'fixture-native', timestamp: Date.now(),
      nonce: Utilities.getUuid().replace(/-/g, ''),
      action: action, payload: payload || {}
    };
    const text = [envelope.keyId, envelope.timestamp, envelope.nonce,
      envelope.action, JSON.stringify(envelope.payload)].join('\n');
    envelope.signature = Utilities.computeHmacSha256Signature(
      text, secret, Utilities.Charset.UTF_8)
      .map(function(b) {return ('0' + (b & 255).toString(16)).slice(-2);})
      .join('');
    return JSON.parse(handle({postData: {contents: JSON.stringify(envelope)}})
      .getContent());
  }
  function payload(requestId) {
    return {expectedRevision: readStateOnlyFake().revision,
      requestId: requestId, id: 'fixture-A', invoiceNo: 70001,
      expectedName: 'Khách giả lập Nguyễn', expectedTotal: 125000,
      confirmed: true, reason: 'Kiểm thử sandbox — không phải giao dịch thật'};
  }
  function getA(handle) {
    const r = signedCall(handle, 'orders.list', {query: '70001'});
    expect(r.ok === true, 'signed list/readback');
    return r.data.orders.filter(function(x) {return x.id === 'fixture-A';})[0];
  }
  try {
    // No production properties, no original global doPost, and no live Drive API.
    const createHandle = new Function('readState_', 'PropertiesService',
      'DriveApp', 'LockService', 'CacheService', 'ContentService',
      'Utilities', 'SatoriAccountingCore', 'AndroidOwnerMobileApi',
      source + '\nreturn SatoriBotApi.handle;');
    const handle = createHandle(readStateOnlyFake, isolatedProperties,
      guardedDrive, isolatedLock, isolatedCache, ContentService, Utilities,
      {}, null);
    const start = signedCall(handle, 'system.status');
    expect(start.ok === true && start.revision === 1 &&
      start.data.orders === 2, 'native signed status reads only two fake bills');

    let p = payload('native-satori-001');
    let r = signedCall(handle, 'payments.markSatoriPaid', p);
    expect(r.ok === true && r.backupCreated === true &&
      r.data.satoriPaid === true && r.data.customerPaid === false,
      'Satori-paid does not mark customer paid');
    expect(getA(handle).status === 'Đã TT Satori', 'Satori status readback');

    r = signedCall(handle, 'payments.markCustomerPaid', {
      expectedRevision: readStateOnlyFake().revision,
      invoiceNo: 70001, id: 'fixture-A', expectedName: 'Khách giả lập Nguyễn',
      expectedTotal: 125000, confirmed: true, amount: 125000
    });
    expect(r.ok === true && r.backupCreated === true,
      'customer paid independent verified write');
    expect(getA(handle).customerPaid === true && getA(handle).satoriPaid === true,
      'both payment flags true');

    r = signedCall(handle, 'payments.markSatoriUnpaid',
      payload('native-satori-002'));
    expect(r.ok === true && r.backupCreated === true &&
      r.data.customerPaid === true && r.data.satoriPaid === false,
      'Satori reversal preserves customer-paid');

    r = signedCall(handle, 'payments.markCustomerUnpaid',
      payload('native-customer-003'));
    expect(r.ok === true && r.backupCreated === true &&
      r.data.customerPaid === false && r.data.satoriPaid === false,
      'customer reversal preserves independent Satori state');
    expect(getA(handle).status === 'Chưa thanh toán',
      'fully unpaid status readback');

    const duplicate = JSON.parse(readStateOnlyFake().values.satori_orders_v15)[1];
    expect(duplicate.id === 'fixture-B' && duplicate.status === 'Chưa thanh toán' &&
      !duplicate.paymentAudit, 'duplicate invoiceNo other ID untouched');

    expect(readStateOnlyFake().revision === 5 && backupIds.length === 4,
      'exactly four changes have four real prewrite Drive backups');

    const audit = JSON.parse(readStateOnlyFake().values.satori_orders_v15)[0]
      .paymentAudit;
    expect(audit.length === 3, 'three new corrections retained in audit');

    const b = backupIds.length;
    const replay = signedCall(handle, 'payments.markCustomerUnpaid',
      Object.assign({}, payload('native-customer-003'),
        {expectedRevision: 4}));
    expect(replay.ok === true && replay.data.alreadyApplied === true &&
      backupIds.length === b, 'stale revision exact requestId replay no write');

    const wrong = signedCall(handle, 'payments.markSatoriPaid',
      Object.assign({}, payload('native-bad-001'),
        {expectedName: 'Wrong synthetic customer'}));
    expect(wrong.ok === false && wrong.error.code === 'ORDER_CHANGED' &&
      backupIds.length === b, 'wrong identity rejected without write');

    const stale = signedCall(handle, 'payments.markSatoriPaid',
      Object.assign({}, payload('native-stale-001'), {expectedRevision: 1}));
    expect(stale.ok === false && stale.error.code === 'REVISION_CONFLICT' &&
      backupIds.length === b, 'stale revision rejected without write');
  } catch (e) {
    problem = String(e && e.message || e);
  }
  // Always restore the exact fake seed, even when a test fails.
  try {
    observedBeforeRestore = readStateOnlyFake().revision;
    if (fakeFile.getBlob().getDataAsString() !== seed) fakeFile.setContent(seed);
    restoredExactly = fakeFile.getBlob().getDataAsString() === seed;
  } catch (e) {
    restoredExactly = false;
    problem = (problem ? problem + '; ' : '') + 'RESTORE: ' + String(e);
  }
  const report = {ok: !problem && restoredExactly,
    testsPassed: checks.length, testsFailed: problem ? 1 : 0,
    error: problem, sandboxOnly: true, productionAccess: false,
    originalFakeRevision: 1, writeRevisionBeforeRestore: observedBeforeRestore,
    restoredExactly: restoredExactly, fakeFileId: fakeFile.getId(),
    backupCount: backupIds.length, finishedAt: new Date().toISOString()};
  folder.createFile('PAYMENT_NATIVE_SANDBOX_REPORT.json',
    JSON.stringify(report, null, 2), MimeType.PLAIN_TEXT);
  console.log('PAYMENT_NATIVE_SANDBOX_RESULT ' + JSON.stringify(report));
  if (!report.ok) throw new Error('PAYMENT_SANDBOX_FAILED: ' + problem);
  return report;
}
