/**
 * Minh Satori — one-time production Gemini V2 canonical Bot API writer setup.
 *
 * OWNER-ONLY. COPY this file into the EXISTING "Minh Satori Drive Sync"
 * Apps Script project, and run satoriGeminiV2WriterSetup exactly ONCE.
 * Never run it in the Gemini customer UI or in a backup/sandbox project.
 *
 * Does NOT modify existing Bot API clients, legacy invoices, routes or deployments.
 * Generates a distinct writer client for the EXISTING signed Bot API.
 * Never print secrets in logs, screenshots, chat, or GitHub.
 *
 * The temporary SATORI_V2_WRITER_TRANSFER_SECRET Script Property exists only
 * so the owner can copy it securely into Render Environment; delete it with
 * satoriGeminiV2WriterFinish AFTER successful production validation.
 */
function satoriGeminiV2WriterSetup() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty('SATORI_BOT_CLIENTS_JSON');
    if (!raw) throw Error('MISSING_EXISTING_BOT_CONFIG_DO_NOT_CREATE_NEW');
    var clients = JSON.parse(raw);
    if (!clients || typeof clients !== 'object' || Array.isArray(clients))
      throw Error('INVALID_EXISTING_BOT_CONFIG');
    var id = 'gemini_v2_writer_20261028';
    if (Object.prototype.hasOwnProperty.call(clients, id))
      throw Error('WRITER_ALREADY_EXISTS_DO_NOT_OVERWRITE');
    if (props.getProperty('SATORI_V2_WRITER_TRANSFER_SECRET'))
      throw Error('PREEXISTING_TRANSFER_SECRET_DO_NOT_OVERWRITE');
    // Generate high-entropy credential, independently of all existing bots.
    var parts = [];
    for (var i = 0; i < 4; i++) {
      var part = Utilities.getUuid().replace(/-/g, '');
      if (!/^[a-f0-9]{32}$/i.test(part)) throw Error('UNEXPECTED_RANDOM_FORMAT');
      parts.push(part);
    }
    var secret = parts.join('');
    clients[id] = {
      enabled: true,
      secret: secret,
      scopes: ['orders:read', 'orders:write']
    };
    var encoded = JSON.stringify(clients);
    if (encoded.length > 8500) throw Error('SCRIPT_PROPERTY_TOO_LARGE');
    props.setProperties({
      SATORI_BOT_CLIENTS_JSON: encoded,
      SATORI_V2_WRITER_TRANSFER_SECRET: secret
    }, false);
    var after = JSON.parse(props.getProperty('SATORI_BOT_CLIENTS_JSON'));
    if (!after[id] || after[id].secret !== secret ||
        after[id].scopes.join(',') !== 'orders:read,orders:write')
      throw Error('WRITER_READBACK_FAILED');
    console.log('GEMINI_V2_WRITER_CREATED_KEY_ID=' + id +
                ' SCOPES=orders:read,orders:write SECRET_NOT_LOGGED');
  } finally {
    lock.releaseLock();
  }
}

// Run only AFTER the signed V2 checkout has successfully committed and
// read back an authentic invoice via the canonical ledger.
function satoriGeminiV2WriterFinish() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    var transfer = props.getProperty('SATORI_V2_WRITER_TRANSFER_SECRET');
    if (!transfer) {
      console.log('GEMINI_V2_WRITER_TRANSFER_ALREADY_CLEARED');
      return;
    }
    var clients = JSON.parse(props.getProperty('SATORI_BOT_CLIENTS_JSON') || '{}');
    var client = clients.gemini_v2_writer_20261028;
    if (!client || client.secret !== transfer ||
        !Array.isArray(client.scopes) ||
        client.scopes.join(',') !== 'orders:read,orders:write')
      throw Error('WRITER_TRANSFER_MISMATCH_DO_NOT_DELETE');
    props.deleteProperty('SATORI_V2_WRITER_TRANSFER_SECRET');
    console.log('GEMINI_V2_WRITER_TEMP_SECRET_CLEARED_CLIENT_PRESERVED');
  } finally {
    lock.releaseLock();
  }
}
