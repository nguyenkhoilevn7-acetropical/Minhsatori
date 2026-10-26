/** Authenticated encrypted archive. No keys or database rows in the public manifest. */
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
const magic=Buffer.from('SATORIV2BACKUP1\n');
const sha=b=>createHash('sha256').update(b).digest('hex');
export function backupKey(value){
 if(typeof value!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(value))throw Error('BACKUP_KEY_REQUIRED');
 const key=Buffer.from(value,'base64');if(key.length!==32)throw Error('BACKUP_KEY_REQUIRED');return key;
}
export function sealBackup(dump,manifest,key){
 if(!Buffer.isBuffer(dump)||dump.subarray(0,5).toString()!=='PGDMP')throw Error('CUSTOM_PG_DUMP_REQUIRED');
 if(key.length!==32)throw Error('BACKUP_KEY_REQUIRED');
 const metadata=Buffer.from(JSON.stringify({...manifest,dumpBytes:dump.length,dumpSha256:sha(dump)}));
 const size=Buffer.alloc(4);size.writeUInt32BE(metadata.length);
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(magic);
 const encrypted=Buffer.concat([cipher.update(Buffer.concat([size,metadata,dump])),cipher.final()]);
 const archive=Buffer.concat([magic,nonce,cipher.getAuthTag(),encrypted]);
 return {archive,receipt:{format:'SATORIV2BACKUP1',bytes:archive.length,sha256:sha(archive)}};
}
export function openBackup(archive,key){
 try{
  if(!archive.subarray(0,magic.length).equals(magic))throw Error();
  let p=magic.length;const nonce=archive.subarray(p,p+=12),tag=archive.subarray(p,p+=16);
  const decipher=createDecipheriv('aes-256-gcm',key,nonce);decipher.setAAD(magic);decipher.setAuthTag(tag);
  // Never return plaintext until authentication succeeds.
  const plain=Buffer.concat([decipher.update(archive.subarray(p)),decipher.final()]);
  const size=plain.readUInt32BE();if(size>1024*1024||size+4>plain.length)throw Error();
  const manifest=JSON.parse(plain.subarray(4,4+size).toString());const dump=plain.subarray(4+size);
  if(dump.subarray(0,5).toString()!=='PGDMP'||dump.length!==manifest.dumpBytes||sha(dump)!==manifest.dumpSha256)throw Error();
  return {manifest,dump};
 }catch{throw Error('BACKUP_AUTHENTICATION_FAILED')}
}
