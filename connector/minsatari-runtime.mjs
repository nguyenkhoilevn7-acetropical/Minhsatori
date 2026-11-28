/**
 * Repo-side Minsatari order-intake adapter for later staging.
 *
 * This module does not listen, deploy, or call a live service. Importing it
 * does not change the installed connector. The connected user-minh-satori
 * surface has six read-only tools; its host and version are unknown here.
 * The separate local scaffold speaks a bearer {method,args} bridge and is not
 * this file. A bearer gateway must not be pointed at the legacy HMAC /exec API.
 *
 * Canonical invoice creation stays on connector/lib/satori.mjs callTool, action
 * orders.create, ledger key satori_orders_v15. HMAC orders.update is not
 * registered; owner mobile OAuth remains the only update path. Zalo is a text
 * template only.
 */
import {callTool, configuration, tools as canonicalTools} from './lib/satori.mjs';

export const CANONICAL_HMAC_CONFIG_NAMES = Object.freeze([
  'SATORI_BOT_API_URL',
  'SATORI_BOT_KEY_ID',
  'SATORI_BOT_SECRET',
  'SATORI_ENABLE_WRITES',
  'GROK_OWNER_WRITES_ENABLED',
]);

export const BEARER_GATEWAY_CONFIG_NAMES = Object.freeze([
  'SATORI_GATEWAY_URL',
  'SATORI_GATEWAY_TOKEN',
  'ENABLE_ORDER_WRITES',
  'ENABLE_ZALO_SEND',
]);

export const LIVE_READONLY_TOOL_NAMES = Object.freeze([
  'satori_system_status',
  'satori_customers_search',
  'satori_products_search',
  'satori_orders_list',
  'satori_debt_summary',
  'satori_invoice_pdf',
]);

const HMAC_READS = new Set([
  'satori_system_status',
  'satori_customers_search',
  'satori_orders_list',
  'satori_debt_summary',
]);

const text = maxLength => ({type: 'string', maxLength});
const day = {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'};
const boundedLimit = maximum => ({type: 'integer', minimum: 1, maximum});

function readTool(name, description, properties, required = []) {
  return {
    name,
    description: 'READ ONLY. ' + description,
    inputSchema: {type: 'object', properties, required, additionalProperties: false},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  };
}

export function liveReadTools() {
  return [
    readTool('satori_system_status', 'Revision and invoice count only.', {}),
    readTool('satori_customers_search', 'Find one delivery profile by name, address, or exact phone.', {
      query: text(150), phone: text(35), limit: boundedLimit(30),
    }),
    readTool('satori_products_search', 'Find a catalogue row by SKU or product name.', {
      query: text(180), limit: boundedLimit(30),
    }, ['query']),
    readTool('satori_orders_list', 'List invoices. This tool does not write.', {
      query: text(150), from: day, to: day, status: text(60), limit: boundedLimit(50),
    }),
    readTool('satori_debt_summary', 'Customer payment and Satori settlement stay distinct.', {
      query: text(150), from: day, to: day,
    }),
    readTool('satori_invoice_pdf', 'Official invoice id and invoice number only. Do not pass a Drive URL.', {
      id: {type: ['string', 'number']},
      invoiceNo: {type: 'integer', minimum: 1},
    }, ['id', 'invoiceNo']),
  ];
}

function writesUnlocked(env) {
  return env?.SATORI_ENABLE_WRITES === 'true' && env?.GROK_OWNER_WRITES_ENABLED === 'true';
}

/** Tools this repo adapter would register. Default matches the live six reads. */
export function listRuntimeTools(env = {}) {
  const reads = liveReadTools();
  if (!writesUnlocked(env)) return reads;
  const create = canonicalTools({...env, SATORI_ENABLE_WRITES: 'true'})
    .find(tool => tool.name === 'satori_orders_create');
  if (!create) throw new Error('Canonical orders.create schema missing');
  return reads.concat([create]);
}

function validate(value, schema, path = 'payload') {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(path + ' must be an object');
    }
    for (const key of schema.required || []) {
      if (value[key] === undefined) throw new Error('Missing ' + path + '.' + key);
    }
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, key)) throw new Error('Unsupported field: ' + key);
      validate(value[key], schema.properties[key], path + '.' + key);
    }
    return;
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const ok = types.some(type => (
    type === 'integer' ? Number.isSafeInteger(value) :
    type === 'array' ? Array.isArray(value) : typeof value === type
  ));
  if (!ok) throw new Error(path + ' has the wrong type');
  if (typeof value === 'number' && (schema.minimum !== undefined && value < schema.minimum ||
      schema.maximum !== undefined && value > schema.maximum)) {
    throw new Error(path + ' is out of range');
  }
  if (typeof value === 'string' && ((schema.maxLength && value.length > schema.maxLength) ||
      (schema.pattern && !new RegExp(schema.pattern).test(value)))) {
    throw new Error(path + ' has the wrong format');
  }
}

export async function callLiveRead({name, payload = {}, env = {}, fetcher}) {
  if (!LIVE_READONLY_TOOL_NAMES.includes(name)) {
    throw new Error('Tool is not a live read: ' + name);
  }
  const tool = liveReadTools().find(item => item.name === name);
  validate(payload, tool.inputSchema);
  if (!HMAC_READS.has(name)) throw new Error('CANONICAL_ACTION_ABSENT');
  if (!configuration(env).configured) throw new Error('UPSTREAM_NOT_CONFIGURED');
  if (typeof fetcher !== 'function') throw new Error('LIVE_FETCH_BLOCKED');
  return callTool(name, payload, env, fetcher);
}

/**
 * Submit a prepared intake only through the existing HMAC orders.create tool.
 * A model-supplied confirmation flag is ignored; authorizeWrite must be the
 * trusted owner callback. fetcher is required so this module cannot use the
 * process-wide network stack by accident.
 */
export async function submitOrderIntake({prepared, env = {}, fetcher, authorizeWrite}) {
  if (!prepared || prepared.status !== 'READY_FOR_OWNER_CONFIRMATION' ||
      prepared.toolCall?.name !== 'satori_orders_create') {
    throw new Error('Order is not ready for submission');
  }
  if (!writesUnlocked(env)) throw new Error('WRITE_DISABLED');
  if (!configuration(env).configured) throw new Error('UPSTREAM_NOT_CONFIGURED');
  if (typeof fetcher !== 'function') throw new Error('LIVE_FETCH_BLOCKED');
  if (typeof authorizeWrite !== 'function') {
    throw new Error('Trusted owner approval callback missing');
  }
  const approved = await authorizeWrite({
    name: prepared.toolCall.name,
    payload: prepared.toolCall.payload,
  });
  if (approved !== true) throw new Error('Owner did not authorize this write');
  return callTool(prepared.toolCall.name, prepared.toolCall.payload, env, fetcher);
}

function assertBearerGatewayUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('BEARER_GATEWAY_URL_INVALID');
  }
  if (parsed.hostname === 'script.google.com' || parsed.pathname.endsWith('/exec')) {
    throw new Error('BEARER_GATEWAY_REJECTS_HMAC_EXEC');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search) {
    throw new Error('BEARER_GATEWAY_URL_INVALID');
  }
}

/**
 * Protocol guard for the scaffold's bearer bridge. No audited upstream is
 * configured in this repository, so every call fails closed before fetch.
 * The intended body shape, once an owner approves a real gateway, is
 * {method, args} with Authorization: Bearer. That dispatch is intentionally
 * not implemented here.
 */
export async function callBearerBridge({env = {}, method}) {
  if (!env.SATORI_GATEWAY_URL || !env.SATORI_GATEWAY_TOKEN) {
    throw new Error('UPSTREAM_NOT_CONFIGURED');
  }
  assertBearerGatewayUrl(env.SATORI_GATEWAY_URL);
  if (method === 'orders.update') {
    throw new Error('HMAC orders.update is owner-mobile only and is not exposed');
  }
  if (typeof method === 'string' && method.toLowerCase().includes('zalo')) {
    throw new Error('ZALO_DISABLED');
  }
  if (method === 'orders.create' && env.ENABLE_ORDER_WRITES !== 'true') {
    throw new Error('WRITE_DISABLED');
  }
  throw new Error('BEARER_BRIDGE_NOT_AUDITED');
}

/** Notification copy only. This does not send Zalo or attach a PDF. */
export function invoiceNotificationText({invoiceNo, recipientName}) {
  if (!Number.isSafeInteger(invoiceNo) || invoiceNo <= 0) {
    throw new Error('Canonical invoice number is required');
  }
  if (typeof recipientName !== 'string' || !recipientName.trim()) {
    throw new Error('Recipient name is required');
  }
  return String(invoiceNo) + '\n' + recipientName.trim();
}
