// Offline contract tests only: synthetic Drive ledger, no network and no real invoices.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '../api/BotApi.gs'), 'utf8');
const accounting = fs.readFileSync(path.join(__dirname, '../accounting-core.js'), 'utf8');
const secret = 'SYNTHETIC_VAT_TEST_SECRET_012345678901234567';
function harness() {
  let ledger = {revision: 1, updatedAt: '2026-11-11T00:00:00Z', values: {
    satori_orders_v15: '[]', satori_trash_bin_v15: '[]', satori_deleted_invoice_nos: '[]'
  }};
  let writes = 0, backups = 0, seq = 0;
  const cache = new Map();
  const context = {
    Date, JSON, Number, String, Object, Array, Math, Error, RegExp,
    readState_: () => JSON.parse(JSON.stringify(ledger)),
    ContentService: {MimeType: {JSON: 'json'}, createTextOutput: text => ({
      text, setMimeType() {return this;}
    })},
    PropertiesService: {getScriptProperties: () => ({getProperty: key => key === 'SATORI_BOT_CLIENTS_JSON'
      ? JSON.stringify({fixture: {secret, enabled: true, scopes: ['orders:read','orders:write','collaborators:pair:write']}}) : null})},
    CacheService: {getScriptCache: () => ({
      get: key => cache.get(key), put: (key, val) => cache.set(key, val)
    })},
    LockService: {getScriptLock: () => ({waitLock() {}, releaseLock() {}})},
    Utilities: {
      Charset: {UTF_8: 'UTF_8'},
      computeHmacSha256Signature: (data, key) => [...crypto.createHmac('sha256', key).update(data).digest()],
      getUuid: () => 'fixture-uuid-' + ++seq,
      formatDate: () => '11/11/2026'
    },
    DriveApp: {getFileById: () => ({
      makeCopy: () => {
        backups++;
        const snapshot = JSON.stringify(ledger);
        return {getId: () => 'fake-backup-' + backups, getBlob: () => ({getDataAsString: () => snapshot})};
      },
      setContent: text => {ledger = JSON.parse(text); writes++;}
    })}
  };
  vm.createContext(context);
  vm.runInContext(accounting, context);
  vm.runInContext(source, context);
  function call(action, payload) {
    const request = {
      keyId: 'fixture', timestamp: Date.now(),
      nonce: 'fixture_nonce_' + String(++seq).padStart(20, '0'), action, payload
    };
    request.signature = crypto.createHmac('sha256', secret).update([
      request.keyId, request.timestamp, request.nonce, request.action, JSON.stringify(payload)
    ].join('\n')).digest('hex');
    return JSON.parse(context.doPost({postData: {contents: JSON.stringify(request)}}).text);
  }
  return {
    context, call, rows: () => JSON.parse(ledger.values.satori_orders_v15),
    revision: () => ledger.revision, writes: () => writes, backups: () => backups
  };
}
function draft(items, extra = {}) {
  const goods = items.reduce((total, x) => total + x.qty * x.unitPrice, 0);
  return {
    name: 'Synthetic VAT Customer', phone: '0900000000', location: '123 Test VAT Street',
    items, shippingAmount: 500, vatAmount: 0, total: goods + 500, ...extra
  };
}
function create(h, requestId, order) {
  return h.call('orders.create', {
    requestId, expectedRevision: h.revision(), confirmedNewCustomer: true, order
  });
}
const water = {product: 'Water', qty: 2, unitPrice: 10000, listPrice: 10000};
const deposit = {product: 'Deposit', qty: 1, unitPrice: 5000, listPrice: 5000};

test('legacy without new tax fields preserves existing invoice VAT and total verbatim', () => {
  const h = harness();
  const result = create(h, 'legacy_00001', draft([water, deposit], {vatAmount: 2000, total: 27500}));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.order.vatAmount, 2000);
  assert.equal(result.data.order.total, 27500);
  assert.equal(h.rows()[0].vatMode, 'invoice');
  assert.equal(h.rows()[0].items.some(x => x.vatRate !== undefined), false);
});
test('invoice vatRate=8 calculates line VAT without double taxation', () => {
  const h = harness();
  const result = create(h, 'rate_000001', draft([water, deposit], {vatRate: 8, vatAmount: 2000, total: 27500}));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.order.vatAmount, 2000);
  assert.equal(h.rows()[0].items.reduce((sum, x) => sum + x.vatAmount, 0), 2000);
  assert.equal(h.rows()[0].vatMode, 'per_line');
});
test('line exemption and custom 10 percent rate use half-up VND rounding independently', () => {
  const h = harness();
  const item = {product: 'Half up', qty: 1, unitPrice: 5, listPrice: 5, vatRate: 10};
  const items = [water, {...deposit, vatExempt: true}, item];
  const result = create(h, 'rates_00001', draft(items, {
    vatRate: 8, vatAmount: 1601, total: 27106
  }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.order.vatAmount, 1601);
  assert.equal(result.data.order.total, 27106);
  assert.equal(h.rows()[0].vatMode, 'per_line');
  assert.deepEqual(h.rows()[0].items.map(x => x.vatAmount), [1600, 0, 1]);
  assert.equal(h.rows()[0].items[1].vatExempt, true);
  assert.equal(h.rows()[0].items[2].vatRate, 10);
});
test('wrong aggregate or item VAT returns VAT_MISMATCH before any ledger write', () => {
  const h = harness();
  const items = [water, {...deposit, vatExempt: true}];
  const bad = draft(items, {vatRate: 8, vatAmount: 2000, total: 27500});
  assert.equal(create(h, 'mismatch_001', bad).error.code, 'VAT_MISMATCH');
  assert.equal(h.writes(), 0);
  const badItem = draft([{...water, vatRate: 8, vatAmount: 999}], {
    vatRate: 8, vatAmount: 999, total: 21499
  });
  assert.equal(create(h, 'mismatch_002', badItem).error.code, 'LINE_VAT_MISMATCH');
  assert.equal(h.writes(), 0);
});
test('duplicate requestId cannot create a second invoice or silently change VAT intent', () => {
  const h = harness();
  const order = draft([water, {...deposit, vatExempt: true}], {
    vatRate: 8, vatAmount: 1600, total: 27100
  });
  const first = create(h, 'dedupe_00001', order);
  assert.equal(first.ok, true, JSON.stringify(first));
  const writes = h.writes();
  const replay = h.call('orders.create', {
    requestId: 'dedupe_00001', expectedRevision: 1, confirmedNewCustomer: true, order
  });
  assert.equal(replay.data.duplicate, true);
  assert.equal(h.writes(), writes);
  const changed = structuredClone(order);
  changed.items[1].vatExempt = false;
  assert.equal(h.call('orders.create', {
    requestId: 'dedupe_00001', expectedRevision: 1, confirmedNewCustomer: true, order: changed
  }).error.code, 'REQUEST_ID_CONFLICT');
  assert.equal(h.rows().length, 1);
});
test('list readback exposes persisted mode and VAT fields per item', () => {
  const h = harness();
  create(h, 'readback_001', draft([water, {...deposit, vatExempt: true}], {
    vatRate: 8, vatAmount: 1600, total: 27100
  }));
  const result = h.call('orders.list', {query: 'Synthetic VAT Customer'});
  assert.equal(result.ok, true, JSON.stringify(result));
  const row = result.data.orders[0];
  assert.equal(row.vatMode, 'per_line');
  assert.equal(row.items[1].vatExempt, true);
  assert.equal(row.items[1].vatAmount, 0);
});
test('paired CTV invoices explicitly refuse new per-line tax fields', () => {
  const h = harness();
  const result = h.call('orders.create.pair', {
    collaboratorId: 'test-ctv', requestId: 'pair_000001',
    order: draft([{...water, vatExempt: true}], {vatRate: 8})
  });
  assert.equal(result.error.code, 'PER_LINE_VAT_NOT_SUPPORTED');
});
