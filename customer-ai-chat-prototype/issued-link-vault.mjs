import crypto from 'node:crypto';

// Server-side owner vault. Only an AES-256-GCM ciphertext is persisted in the
// revisioned Google Drive ledger; the customer never receives this payload.
const fail=code=>{const e=new Error(code);e.code=code;throw e};
export function createIssuedLinkVault({env=process.env,rand=crypto.randomBytes}={}){
 const secret=String(env.SATORI_OWNER_CHECKOUT_SECRET||env.SATORI_BOT_SECRET||'');
 function key(){
  if(secret.length<32)fail('LINK_VAULT_NOT_CONFIGURED');
  return crypto.hkdfSync('sha256',Buffer.from(secret),
   Buffer.from('MinhSatori-Owner-Only-Issued-Link-PIN-Salt-v1'),
   Buffer.from('AES-GCM-Google-Drive-v1'),32);
 }
 function validate(link,code){
  if(typeof link!=='string'||!/^https:\/\/minh-satori-customer-ai-gemini\.onrender\.com\/(?:real|ctv)\/#[-_A-Za-z0-9.]{50,15000}$/.test(link))
   fail('LINK_VAULT_INVALID_LINK');
  if(typeof code!=='string'||code.length<12||code.length>100||
     !/^[A-Za-z0-9_-]+$/.test(code))fail('LINK_VAULT_INVALID_CODE');
 }
 function seal(link,code){
  validate(link,code);
  const iv=rand(12),c=crypto.createCipheriv('aes-256-gcm',key(),iv);
  c.setAAD(Buffer.from(link,'utf8'));
  const data=Buffer.concat([c.update(Buffer.from(code,'utf8')),c.final()]);
  return [iv,c.getAuthTag(),data].map(v=>v.toString('base64url')).join('.');
 }
 function open(link,encrypted){
  validate(link,'VALIDPLACEHOLDER');
  if(typeof encrypted!=='string'||encrypted.length>350||
   !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(encrypted))
   fail('LINK_VAULT_NOT_AVAILABLE');
  try{
   const [iv,tag,ct]=encrypted.split('.').map(x=>Buffer.from(x,'base64url'));
   if(iv.length!==12||tag.length!==16||ct.length>150)fail('LINK_VAULT_NOT_AVAILABLE');
   const d=crypto.createDecipheriv('aes-256-gcm',key(),iv);
   d.setAAD(Buffer.from(link,'utf8'));d.setAuthTag(tag);
   const code=Buffer.concat([d.update(ct),d.final()]).toString('utf8');
   validate(link,code);
   return code;
  }catch(e){if(e?.code==='LINK_VAULT_NOT_CONFIGURED')throw e;fail('LINK_VAULT_CANNOT_DECRYPT')}
 }
 return Object.freeze({seal,open});
}
