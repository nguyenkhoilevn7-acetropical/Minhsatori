/**
 * Grok bridge for the EXISTING Minh Satori HMAC connector. No second ledger.
 * No production write is possible unless two server-side flags and a trusted
 * per-invocation owner approval callback are supplied by the Grok gateway.
 */
export const GROK_OWNER_WRITE_NAMES = Object.freeze([
  'satori_orders_create',
  'satori_mark_customer_paid',
  'satori_mark_customer_unpaid',
  'satori_mark_satori_paid',
  'satori_mark_satori_unpaid',
  'satori_soft_delete_order',
  'satori_restore_order',
]);
const writeSet = new Set(GROK_OWNER_WRITE_NAMES);
const isExplicitlyEnabled = env =>
  env?.SATORI_ENABLE_WRITES === 'true' && env?.GROK_OWNER_WRITES_ENABLED === 'true';

/**
 * Append only the missing seven write-tool definitions to the EXISTING Grok
 * connector. Grok's six read tools (including satori_invoice_pdf) remain intact.
 * canonicalTools = tools(env) from connector/lib/satori.mjs.
 */
export function grokAdditionalTools({canonicalTools, env = {}}) {
  if (!Array.isArray(canonicalTools)) throw new TypeError('canonicalTools must be an array');
  if (!isExplicitlyEnabled(env)) return [];
  const indexed = new Map(canonicalTools.map(tool => [tool.name, tool]));
  return GROK_OWNER_WRITE_NAMES.map(name => {
    const tool = indexed.get(name);
    if (!tool || tool.annotations?.readOnlyHint !== false) {
      throw new Error('Canonical write tool not available: ' + name);
    }
    return tool;
  });
}

/**
 * Only the existing connector/lib/satori.mjs callTool may execute writes.
 * authorizeWrite MUST be a trusted gateway callback which authenticates the
 * actual owner and binds approval to the exact tool invocation and payload.
 * A model-supplied "confirmed: true" is not owner authorization.
 */
export async function executeGrokOwnerWrite({
  name, payload, env = {}, canonicalTools, canonicalCallTool, authorizeWrite,
}) {
  if (!writeSet.has(name)) throw new Error('Unsupported Grok write action');
  if (!isExplicitlyEnabled(env)) throw new Error('Grok owner writes are disabled');
  if (typeof canonicalCallTool !== 'function') throw new Error('Canonical action executor missing');
  const exposed = grokAdditionalTools({canonicalTools, env});
  if (!exposed.some(tool => tool.name === name)) {
    throw new Error('Action not enabled by canonical connector');
  }
  if (typeof authorizeWrite !== 'function') throw new Error('Trusted owner approval callback missing');
  const approved = await authorizeWrite({name, payload});
  if (approved !== true) throw new Error('Owner did not authorize this write');
  return canonicalCallTool(name, payload, env);
}

/**
 * Read-only metadata plan. Does not fetch PDF, send Zalo, or start a watcher.
 * The notification message contains ONLY invoice number and recipient name.
 */
export function pendingInvoiceDelivery({id, invoiceNo, recipientName}) {
  if (!(typeof id === 'string' && id.trim() || Number.isSafeInteger(id) && id > 0)) {
    throw new Error('Canonical invoice ID is required');
  }
  if (!Number.isSafeInteger(invoiceNo) || invoiceNo <= 0) {
    throw new Error('Canonical invoice number is required');
  }
  if (typeof recipientName !== 'string' || !recipientName.trim()) {
    throw new Error('Recipient name is required');
  }
  return {
    state: 'AWAITING_VERIFIED_PDF_AND_ZALO_SEND',
    pdfTool: 'satori_invoice_pdf',
    pdfArgs: {id, invoiceNo},
    notificationText: String(invoiceNo) + '\n' + recipientName.trim(),
    dedupeKey: String(id) + ':' + String(invoiceNo),
  };
}
