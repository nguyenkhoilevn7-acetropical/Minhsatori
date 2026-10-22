/**
 * OWNER-RUN ONE TIME in Apps Script editor of the existing Minh Satori Drive
 * Sync project. Do NOT paste into the public Gemini project or deploy a new
 * web app. Do NOT log/reveal the secret.
 *
 * Adds exactly one read-only Bot API client WITHOUT replacing old clients.
 * Temporarily keeps the generated HMAC in Script Properties so the owner can
 * copy it privately to SATORI_READ_HMAC_SECRET on Render.
 */
function satoriGeminiReadOnlySetup() {
  var lock=LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props=PropertiesService.getScriptProperties();
    var existing=props.getProperty('SATORI_BOT_CLIENTS_JSON');
    if(!existing)throw Error('MISSING_EXISTING_BOT_CONFIG');
    var clients=JSON.parse(existing);
    if(!clients || typeof clients!=='object' || Array.isArray(clients))
      throw Error('INVALID_EXISTING_BOT_CONFIG');
    var id='gemini_readonly_20261022';
    if(Object.prototype.hasOwnProperty.call(clients,id))
      throw Error('GEMINI_CLIENT_ALREADY_EXISTS_DO_NOT_OVERWRITE');
    // Utilities.getUuid supplies independently generated random UUIDs.
    // Concatenate four UUID payloads rather than depending on a human password.
    var uuids=[];
    for(var i=0;i<4;i++){
      var v=Utilities.getUuid().replace(/-/g,'');
      if(!/^[a-f0-9]{32}$/i.test(v))throw Error('UNEXPECTED_RANDOM_ID_FORMAT');
      uuids.push(v);
    }
    var secret=uuids.join('');
    clients[id]={enabled:true,secret:secret,scopes:['orders:read','customers:read']};
    var updated=JSON.stringify(clients);
    // Apps Script property value limit is 9 KB; abort rather than truncating.
    if(updated.length>8500)throw Error('BOT_CONFIG_TOO_LARGE');
    props.setProperties({
      SATORI_BOT_CLIENTS_JSON:updated,
      SATORI_GEMINI_READONLY_TRANSFER_KEY:secret
    },false);
    var after=JSON.parse(props.getProperty('SATORI_BOT_CLIENTS_JSON'));
    if(after[id].secret!==secret || after[id].scopes.join(',')!=='orders:read,customers:read')
      throw Error('BOT_CONFIG_READBACK_FAILED');
    console.log('GEMINI_READONLY_CLIENT_CREATED_SCOPES_ONLY_NO_SECRET_LOGGED');
  }finally{
    lock.releaseLock();
  }
}
