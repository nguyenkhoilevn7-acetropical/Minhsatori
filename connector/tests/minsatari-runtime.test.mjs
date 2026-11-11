// Offline Minsatari intake → canonical orders.create. No network, deploy, or live ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHmac, randomUUID} from 'node:crypto';
import {callTool} from '../lib/satori.mjs';
import {prepareOrderIntake} from '../order-intake.mjs';
import {
  LIVE_READONLY_TOOL_NAMES,
  listRuntimeTools,
  callLiveRead,
  submitOrderIntake,
  callBearerBridge,
  invoiceNotificationText,
  CANONICAL_HMAC_CONFIG_NAMES,
  BEARER_GATEWAY_CONFIG_NAMES,
} from '../minsatari-runtime.mjs';

const root = new URL('../../', import.meta.url);
const secret = 'SYNTHETIC_ONLY_KEY_012345678901234567890123456789';
const hmacEnv = {
  SATORI_BOT_API_URL: 'https://script.google.com/macros/s/FAKE_NON_NETWORK/exec',
  SATORI_BOT_KEY_ID: 'fixture-client',
  SATORI_BOT_SECRET: secret,
  SATORI_ENABLE_WRITES: 'true',
  GROK_OWNER_WRITES_ENABLED: 'true',
};
const profile = {
  id: 'fixture-A', invoiceNo: 70001, name: 'Ốc Q', phone: '0900000001',
  address: '101 Đường Thử A', defaultVatRate: 8,
};
const catalogue = [
  {code: 'WATER-1500', name: 'Nước suối 1.5L', unit: 'Thùng', unitPrice: 70000, listPrice: 90000},
];

function intake(extra = {}) {
  return prepareOrderIntake({
    source: 'text',
    transcript: 'Lên đơn 2 thùng nước và một khoản thủ công cho Ốc Q',
    extracted: {
      customer: {name: 'Ốc Q', phone: '0900000001', address: '101 Đường Thử A'},
      items: [
        {product: 'Nước suối 1.5L', qty: 2},
        {manualEntry: true, product: 'Tiền cọc', qty: 1, unit: 'Khoản', unitPrice: 500000},
      ],
      shippingAmount: 0,
    },
    customerProfile: profile,
    catalogue,
    expectedRevision: 1,
    requestId: 'fake-order-0001',
    ...extra,
  });
}

function appsScriptFixture() {
  let data = {revision: 1, updatedAt: '2026-11-11T00:00:00Z', values: {
    satori_orders_v15: JSON.stringify([{
      id: 'fixture-A', invoiceNo: 70001, name: 'Ốc Q', phone: '0900000001',
      location: '101 Đường Thử A', total: 1000, status: 'Chưa thanh toán', items: [],
    }]),
    satori_trash_bin_v15: '[]',
    satori_deleted_invoice_nos: '[]',
  }};
  let writes = 0;
  const cache = new Map();
  const scopes = ['orders:read', 'orders:write'];
  const ctx = {
    Date, JSON, Number, String, Object, Array, Math, Error, RegExp,
    readState_: () => structuredClone(data),
    ContentService: {MimeType: {JSON: 'json'}, createTextOutput(text) {
      return {text, setMimeType() { return this; }};
    }},
    PropertiesService: {getScriptProperties: () => ({getProperty: key => (
      key === 'STATE_FILE_ID' ? 'synthetic-file' :
      key === 'SATORI_BOT_CLIENTS_JSON' ? JSON.stringify({
        'fixture-client': {enabled: true, secret, scopes},
      }) : null
    )})},
    CacheService: {getScriptCache: () => ({
      get: key => cache.get(key) || null,
      put: (key, value) => cache.set(key, value),
    })},
    LockService: {getScriptLock: () => ({waitLock() {}, releaseLock() {}})},
    Utilities: {
      Charset: {UTF_8: 'UTF_8'},
      computeHmacSha256Signature: (message, key, charset) => {
        assert.equal(charset, 'UTF_8');
        return [...createHmac('sha256', key).update(message, 'utf8').digest()];
      },
      getUuid: randomUUID,
      formatDate: () => '11/11/2026',
    },
    DriveApp: {getFileById: id => {
      assert.equal(id, 'synthetic-file');
      return {
        makeCopy() {
          const copy = JSON.stringify(data);
          return {getId: () => 'backup-1', getBlob: () => ({getDataAsString: () => copy})};
        },
        setContent(raw) { data = JSON.parse(raw); writes++; },
      };
    }},
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('accounting-core.js', root), 'utf8'), ctx);
  vm.runInContext(readFileSync(new URL('api/BotApi.gs', root), 'utf8'), ctx);
  const fetcher = async (url, options) => {
    assert.equal(url, hmacEnv.SATORI_BOT_API_URL);
    assert.equal(options.method, 'POST');
    assert.ok(!options.body.includes(secret));
    const envelope = JSON.parse(options.body);
    assert.equal(envelope.action === 'orders.update', false);
    return Response.json(JSON.parse(ctx.doPost({postData: {contents: options.body}}).text));
  };
  return {fetcher, writes: () => writes, read: () => structuredClone(data)};
}

test('config names are documented without embedding endpoint or secret values', () => {
  assert.deepEqual(CANONICAL_HMAC_CONFIG_NAMES, [
    'SATORI_BOT_API_URL', 'SATORI_BOT_KEY_ID', 'SATORI_BOT_SECRET',
    'SATORI_ENABLE_WRITES', 'GROK_OWNER_WRITES_ENABLED',
  ]);
  assert.deepEqual(BEARER_GATEWAY_CONFIG_NAMES, [
    'SATORI_GATEWAY_URL', 'SATORI_GATEWAY_TOKEN',
    'ENABLE_ORDER_WRITES', 'ENABLE_ZALO_SEND',
  ]);
  const source = readFileSync(new URL('../minsatari-runtime.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes('script.google.com/macros/s/'), false);
  assert.equal(source.includes(secret), false);
});

test('default tool list matches the live six read-only tools and hides create, update, and Zalo', () => {
  const names = listRuntimeTools({}).map(tool => tool.name);
  assert.deepEqual(names, [...LIVE_READONLY_TOOL_NAMES]);
  assert.equal(names.length, 6);
  assert.equal(names.includes('satori_orders_create'), false);
  assert.equal(names.includes('satori_orders_update'), false);
  assert.equal(names.some(name => name.toLowerCase().includes('zalo')), false);
  for (const tool of listRuntimeTools({})) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
});

test('write exposure adds only canonical orders.create and keeps per-line tax in its schema', () => {
  const names = listRuntimeTools(hmacEnv).map(tool => tool.name);
  assert.deepEqual(names, [...LIVE_READONLY_TOOL_NAMES, 'satori_orders_create']);
  const create = listRuntimeTools(hmacEnv).find(tool => tool.name === 'satori_orders_create');
  const item = create.inputSchema.properties.order.properties.items.items.properties;
  assert.equal(typeof item.vatRate, 'object');
  assert.equal(typeof item.vatAmount, 'object');
  assert.equal(names.includes('satori_orders_update'), false);
  const oneFlag = listRuntimeTools({SATORI_ENABLE_WRITES: 'true'}).map(tool => tool.name);
  assert.equal(oneFlag.includes('satori_orders_create'), false);
});

test('missing required intake fields produce no canonical create call', async () => {
  const prepared = intake({
    customerProfile: null,
    extracted: {customer: {name: 'Ốc Q'}, items: [{qty: 2}]},
  });
  assert.equal(prepared.status, 'NEEDS_CONFIRMATION');
  assert.equal(prepared.toolCall, undefined);
  const codes = prepared.issues.map(issue => issue.code);
  assert.equal(codes.includes('ADDRESS_REQUIRED'), true);
  assert.equal(codes.includes('PRODUCT_NOT_FOUND'), true);
  assert.equal(codes.includes('QUANTITY_REQUIRED'), false);
  assert.equal(codes.includes('CUSTOMER_SELECTION_REQUIRED'), true);
  let fetches = 0;
  await assert.rejects(() => submitOrderIntake({
    prepared, env: hmacEnv, fetcher: async () => { fetches++; },
    authorizeWrite: async () => true,
  }), /not ready/);
  assert.equal(fetches, 0);
});

test('verified default is invoice-level for catalogue and manual rows; explicit line choice opts in', () => {
  const taxed = intake();
  const order = taxed.toolCall.payload.order;
  assert.equal(taxed.draft.vatMode, 'invoice');
  assert.deepEqual(order.items.map(line => line.vatRate), [undefined, undefined]);
  assert.equal(Object.hasOwn(order, 'vatRate'), false);
  assert.equal(Object.hasOwn(order, 'vatMode'), false);
  assert.equal(order.vatAmount, 51200);
  assert.equal(order.total, 691200);
  const exemptProfile = intake({customerProfile: {...profile, defaultVatRate: 0}});
  assert.deepEqual(exemptProfile.toolCall.payload.order.items.map(line => line.vatRate), [undefined, undefined]);
  assert.equal(exemptProfile.toolCall.payload.order.total, 640000);
  const explicit = intake({extracted: {
    customer: {name: 'Ốc Q', phone: '0900000001', address: '101 Đường Thử A'},
    items: [{product: 'Nước suối 1.5L', qty: 1, taxChoiceExplicit: true, vatRate: 0}],
    shippingAmount: 0,
  }});
  assert.equal(explicit.draft.vatMode, 'per_line');
  assert.equal(explicit.toolCall.payload.order.items[0].vatRate, 0);
  assert.equal(explicit.toolCall.payload.order.vatAmount, 0);
});

test('owner denial, disabled flags, and missing HMAC config fail closed before any fetch', async () => {
  const prepared = intake();
  const ledger = appsScriptFixture();
  let fetches = 0;
  const counting = async (...args) => { fetches++; return ledger.fetcher(...args); };
  await assert.rejects(() => submitOrderIntake({
    prepared, env: hmacEnv, fetcher: counting, authorizeWrite: async () => false,
  }), /did not authorize/);
  await assert.rejects(() => submitOrderIntake({
    prepared, env: {...hmacEnv, GROK_OWNER_WRITES_ENABLED: 'false'},
    fetcher: counting, authorizeWrite: async () => true,
  }), /WRITE_DISABLED/);
  await assert.rejects(() => submitOrderIntake({
    prepared, env: {...hmacEnv, SATORI_BOT_API_URL: ''},
    fetcher: counting, authorizeWrite: async () => true,
  }), /UPSTREAM_NOT_CONFIGURED/);
  await assert.rejects(() => submitOrderIntake({
    prepared, env: hmacEnv, authorizeWrite: async () => true,
  }), /LIVE_FETCH_BLOCKED/);
  assert.equal(fetches, 0);
  assert.equal(ledger.writes(), 0);
});

test('approved intake creates one canonical order and a duplicate retry does not write again', async () => {
  const prepared = intake();
  const ledger = appsScriptFixture();
  const approve = async ({name, payload}) =>
    name === 'satori_orders_create' && payload.requestId === 'fake-order-0001';
  const first = await submitOrderIntake({
    prepared, env: hmacEnv, fetcher: ledger.fetcher, authorizeWrite: approve,
  });
  assert.equal(first.ok, true);
  assert.equal(first.data.duplicate, false);
  assert.equal(first.data.order.invoiceNo > 70001, true);
  const stored = JSON.parse(ledger.read().values.satori_orders_v15)[0];
  assert.deepEqual(stored.items.map(item => item.vatRate), [undefined, undefined]);
  assert.equal(stored.vatMode, 'invoice');
  assert.equal(stored.vatAmount, 51200);
  assert.equal(stored.total, 691200);
  assert.equal(stored.apiRequestId, 'fake-order-0001');
  const retry = await submitOrderIntake({
    prepared, env: hmacEnv, fetcher: ledger.fetcher, authorizeWrite: approve,
  });
  assert.equal(retry.data.duplicate, true);
  assert.equal(retry.data.order.invoiceNo, first.data.order.invoiceNo);
  assert.equal(ledger.writes(), 1);
  const created = JSON.parse(ledger.read().values.satori_orders_v15)
    .filter(row => row.apiRequestId === 'fake-order-0001');
  assert.equal(created.length, 1);
});

test('live read tools that have no canonical HMAC action are not invented', async () => {
  let fetches = 0;
  await assert.rejects(() => callLiveRead({
    name: 'satori_products_search', payload: {query: 'water'},
    env: hmacEnv, fetcher: async () => { fetches++; },
  }), /CANONICAL_ACTION_ABSENT/);
  await assert.rejects(() => callLiveRead({
    name: 'satori_invoice_pdf', payload: {id: 'fixture-A', invoiceNo: 70001},
    env: hmacEnv, fetcher: async () => { fetches++; },
  }), /CANONICAL_ACTION_ABSENT/);
  await assert.rejects(() => callLiveRead({
    name: 'satori_system_status', payload: {}, env: {}, fetcher: async () => { fetches++; },
  }), /UPSTREAM_NOT_CONFIGURED/);
  await assert.rejects(() => callLiveRead({
    name: 'satori_orders_create', payload: {}, env: hmacEnv, fetcher: async () => { fetches++; },
  }), /not a live read/);
  assert.equal(fetches, 0);
});

test('configured system status uses the canonical HMAC connector and a fake ledger', async () => {
  const ledger = appsScriptFixture();
  const result = await callLiveRead({
    name: 'satori_system_status', payload: {}, env: hmacEnv, fetcher: ledger.fetcher,
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.orders, 1);
  assert.equal(ledger.writes(), 0);
});

test('bearer bridge stays fail-closed and refuses a legacy HMAC exec URL', async () => {
  let fetches = 0;
  const fetcher = async () => { fetches++; return {ok: true}; };
  await assert.rejects(() => callBearerBridge({
    env: {}, method: 'system.status', args: {}, fetcher,
  }), /UPSTREAM_NOT_CONFIGURED/);
  await assert.rejects(() => callBearerBridge({
    env: {
      SATORI_GATEWAY_URL: 'https://script.google.com/macros/s/FAKE_NON_NETWORK/exec',
      SATORI_GATEWAY_TOKEN: 'synthetic-token',
      ENABLE_ORDER_WRITES: 'true',
    },
    method: 'orders.create', args: {requestId: 'fake-order-0001'}, fetcher,
  }), /BEARER_GATEWAY_REJECTS_HMAC_EXEC/);
  await assert.rejects(() => callBearerBridge({
    env: {
      SATORI_GATEWAY_URL: 'https://gateway.example.test/minsatari',
      SATORI_GATEWAY_TOKEN: 'synthetic-token',
    },
    method: 'orders.create', args: {}, fetcher,
  }), /WRITE_DISABLED/);
  await assert.rejects(() => callBearerBridge({
    env: {
      SATORI_GATEWAY_URL: 'https://gateway.example.test/minsatari',
      SATORI_GATEWAY_TOKEN: 'synthetic-token',
      ENABLE_ORDER_WRITES: 'true',
    },
    method: 'orders.update', args: {}, fetcher,
  }), /orders\.update/);
  await assert.rejects(() => callBearerBridge({
    env: {
      SATORI_GATEWAY_URL: 'https://gateway.example.test/minsatari',
      SATORI_GATEWAY_TOKEN: 'synthetic-token',
      ENABLE_ZALO_SEND: 'true',
    },
    method: 'zalo.send', args: {}, fetcher,
  }), /ZALO_DISABLED/);
  assert.equal(fetches, 0);
  assert.equal(typeof callTool, 'function');
});

test('Zalo text is only the invoice number and recipient name, and sending stays disabled', () => {
  assert.equal(invoiceNotificationText({
    invoiceNo: 9101, recipientName: 'Người nhận giả',
  }), '9101\nNgười nhận giả');
  assert.throws(() => invoiceNotificationText({invoiceNo: 9101, recipientName: '  '}), /Recipient/);
  assert.equal(listRuntimeTools(hmacEnv).some(tool => tool.name.includes('zalo')), false);
});


test('deliberate mixed-tax intake roundtrips exemption, amount, deliveryNote and stable requestId in fake ledger', async () => {
  const prepared = intake({extracted:{
    customer:{name:'Ốc Q',phone:'0900000001',address:'101 Đường Thử A'},
    vatMode:'per_line', vatRate:8, deliveryNote:'Phiếu giao giả — không gửi',
    items:[
      {product:'Nước suối 1.5L',qty:2},
      {manualEntry:true,product:'Cọc bình',qty:1,unit:'Khoản',unitPrice:500000,vatExempt:true,vatAmount:0},
      {manualEntry:true,product:'Phí lẻ',qty:1,unit:'Lần',unitPrice:5,vatRate:10,vatAmount:1}
    ]
  }});
  assert.equal(prepared.status,'READY_FOR_OWNER_CONFIRMATION');
  assert.equal(prepared.toolCall.payload.order.items[1].vatExempt,true);
  const ledger = appsScriptFixture();
  const args = {prepared,env:hmacEnv,fetcher:ledger.fetcher,authorizeWrite:async()=>true};
  const first = await submitOrderIntake(args);
  assert.equal(first.ok,true);
  assert.equal(first.data.order.vatMode,'per_line');
  assert.equal(first.data.order.vatAmount,11201);
  assert.equal(first.data.order.total,651206);
  assert.deepEqual(first.data.order.items.map(i=>i.vatRate),[8,0,10]);
  assert.deepEqual(first.data.order.items.map(i=>i.vatExempt),[false,true,false]);
  assert.deepEqual(first.data.order.items.map(i=>i.vatAmount),[11200,0,1]);
  assert.equal(first.data.order.deliveryNote,'Phiếu giao giả — không gửi');
  const listed = await callLiveRead({name:'satori_orders_list',payload:{},env:hmacEnv,fetcher:ledger.fetcher});
  assert.equal(listed.ok,true);
  assert.ok(JSON.stringify(listed.data).includes('Phiếu giao giả — không gửi'));
  const retry = await submitOrderIntake(args);
  assert.equal(retry.data.duplicate,true);
  assert.equal(ledger.writes(),1);
  const changed = structuredClone(prepared);
  changed.toolCall.payload.order.deliveryNote='Đổi phiếu giao';
  await assert.rejects(() => submitOrderIntake({...args,prepared:changed}), /REQUEST_ID_CONFLICT/);
  assert.equal(ledger.writes(),1);
});

test('tampered VAT snapshots are rejected by canonical server without a fake ledger write', async () => {
  for (const [field,code] of [['vatAmount','VAT_MISMATCH'],['lineVatAmount','LINE_VAT_MISMATCH']]) {
    const prepared = intake({extracted:{
      customer:{name:'Ốc Q',phone:'0900000001',address:'101 Đường Thử A'},
      vatMode:'per_line',items:[{product:'Nước suối 1.5L',qty:1}]
    }});
    if (field==='vatAmount') prepared.toolCall.payload.order.vatAmount=1;
    else prepared.toolCall.payload.order.items[0].vatAmount=1;
    const ledger = appsScriptFixture();
    await assert.rejects(() => submitOrderIntake({prepared,env:hmacEnv,fetcher:ledger.fetcher,authorizeWrite:async()=>true}), new RegExp(code));
    assert.equal(ledger.writes(),0);
  }
});
