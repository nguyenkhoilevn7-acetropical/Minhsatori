
function testRunSatori() {
  console.log("RUN_OK");
  }
  

function satoriOrdersUpdateDeploymentReadOnly() {
 requireOwner_();
 const props=PropertiesService.getScriptProperties();
 const clients=JSON.parse(props.getProperty('SATORI_BOT_CLIENTS_JSON')||'{}');
 const file=DriveApp.getFileById(props.getProperty('STATE_FILE_ID'));
 const raw=file.getBlob().getDataAsString(),state=JSON.parse(raw);
 const digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,raw,Utilities.Charset.UTF_8).map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');
 console.log(JSON.stringify({readOnly:true,revision:state.revision,orders:JSON.parse(state.values.satori_orders_v15).length,ledgerSha256:digest,clients:Object.entries(clients).map(([id,c])=>({id,enabled:c.enabled!==false,role:c.role||null,editScope:Array.isArray(c.scopes)&&c.scopes.indexOf('orders:update')>=0}))}));
}

// Run only after the owner confirms granting the two new edit clients access.
// Generates new isolated credentials server-side; never changes existing clients.
function provisionSatoriOwnerInvoiceEditClients() {
 requireOwner_();
 if(ScriptApp.getScriptId()!=='1eNEyHXe891ziuT4UY9ij-FellKSZ7Psi8y-5q0O2aiRaOsTA5x-eXOZg')throw Error('WRONG_PROJECT');
 const p=PropertiesService.getScriptProperties(),raw=p.getProperty('SATORI_BOT_CLIENTS_JSON');
 if(!raw)throw Error('MISSING_CLIENTS');
 const clients=JSON.parse(raw),backup='SATORI_ORDER_EDIT_CLIENTS_BACKUP_20261114';
 if(!p.getProperty(backup))p.setProperty(backup,raw);
 for(const channel of ['CHATGPT','GROK']){
  const key=channel.toLowerCase()+'-orders-edit-20261114',existing=clients[key];
  if(existing){if(existing.role!=='owner'||!existing.scopes?.includes('orders:update')||typeof existing.secret!=='string'||existing.secret.length<64)throw Error('EXISTING_CLIENT_MISMATCH');}
  else clients[key]={enabled:true,role:'owner',scopes:['orders:read','orders:update'],secret:Utilities.getUuid()+Utilities.getUuid()+Utilities.getUuid()};
  p.setProperty('SATORI_ORDERS_UPDATE_'+channel+'_KEY_ID',key);
  p.setProperty('SATORI_ORDERS_UPDATE_'+channel+'_SECRET',clients[key].secret);
 }
 p.setProperty('SATORI_BOT_CLIENTS_JSON',JSON.stringify(clients));
 const saved=JSON.parse(p.getProperty('SATORI_BOT_CLIENTS_JSON'));
 if(!Object.keys(clients).every(k=>JSON.stringify(clients[k])===JSON.stringify(saved[k])))throw Error('CONFIG_READBACK_FAILED');
 console.log(JSON.stringify({configured:true,newOwnerEditClients:2,existingClientsPreserved:true,credentialsStoredServerSide:true,ledgerModified:false}));
}
