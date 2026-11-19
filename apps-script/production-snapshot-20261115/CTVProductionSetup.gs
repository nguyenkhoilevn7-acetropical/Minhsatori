/** Owner-run, one-time provisioning. Never logs credentials or changes invoices. */
function prepareCTVProductionCredentials() {
  requireOwner_();
  if (ScriptApp.getScriptId() !== '1eNEyHXe891ziuT4UY9ij-FellKSZ7Psi8y-5q0O2aiRaOsTA5x-eXOZg') throw Error('WRONG_PROJECT');
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var p = PropertiesService.getScriptProperties();
    var raw = p.getProperty('SATORI_BOT_CLIENTS_JSON');
    if (!raw) throw Error('CLIENT_CONFIG_MISSING');
    var clients = JSON.parse(raw);
    if (!clients || Array.isArray(clients) || typeof clients !== 'object') throw Error('CLIENT_CONFIG_INVALID');
    var approveId = 'gemini_ctv_approve_20261023';
    var writeId = 'gemini_ctv_write_20261023';
    var bundleKey = 'SATORI_CTV_RENDER_ENV_TRANSFER_20261023';
    if (clients[approveId] || clients[writeId] || p.getProperty(bundleKey)) {
      if (!clients[approveId] || !clients[writeId] || !p.getProperty(bundleKey)) throw Error('PARTIAL_SETUP_REVIEW_REQUIRED');
      console.log('CTV_CREDENTIALS_ALREADY_PREPARED_NO_ROTATION'); return;
    }
    var backupKey = 'SATORI_BOT_CLIENTS_JSON_PRE_CTV_20261023';
    if (p.getProperty(backupKey)) throw Error('BACKUP_EXISTS_REVIEW_REQUIRED');
    p.setProperty(backupKey, raw);
    if (p.getProperty(backupKey) !== raw) throw Error('BACKUP_VERIFY_FAILED');
    function freshKey() { return (Utilities.getUuid()+Utilities.getUuid()+Utilities.getUuid()).replace(/-/g,''); }
    var approve = freshKey(), writer = freshKey(), link = freshKey();
    clients[approveId] = {enabled:true,secret:approve,scopes:['collaborators:pair:approve']};
    clients[writeId] = {enabled:true,secret:writer,scopes:['collaborators:pair:write']};
    var env = [
      'SATORI_CTV_PAIR_ENDPOINT=https://script.google.com/macros/s/REDACTED_DEPLOYMENT_ID/exec',
      'SATORI_CTV_PAIR_APPROVE_KEY_ID='+approveId,
      'SATORI_CTV_PAIR_APPROVE_SECRET='+approve,
      'SATORI_CTV_PAIR_WRITE_KEY_ID='+writeId,
      'SATORI_CTV_PAIR_WRITE_SECRET='+writer,
      'GEMINI_CTV_LINK_SECRET='+link,
      'SATORI_CTV_PAIR_CONFIG_ENABLED=1',
      'SATORI_CTV_PAIR_ORDER_ENABLED=1',
      'GEMINI_COLLABORATOR_SINGLE_LINKS_ENABLED=1'
    ].join('\n');
    var next = {}; next['SATORI_BOT_CLIENTS_JSON'] = JSON.stringify(clients); next[bundleKey] = env;
    p.setProperties(next, false);
    if (p.getProperty('SATORI_BOT_CLIENTS_JSON') !== next['SATORI_BOT_CLIENTS_JSON'] || p.getProperty(bundleKey) !== env) throw Error('SETUP_READBACK_FAILED');
    console.log('CTV_CREDENTIALS_PREPARED_READ_KEY_UNCHANGED_NO_INVOICE_WRITES');
  } finally { lock.releaseLock(); }
}
