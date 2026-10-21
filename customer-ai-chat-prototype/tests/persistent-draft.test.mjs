/** Shared TEST basket survives separate browser and Android WebView sessions + restarts. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {makeDraftStore} from '../unified-draft.mjs';
import {createSandboxBackup,verifySandboxBackup} from '../sandbox-backup.mjs';
import {encryptArchive,decryptArchive} from '../drive-backup.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'satori-shared-cart-'));
let n=0;const ok=(cond,msg)=>{assert.ok(cond,msg);n++};
const token='TEST-LINK-'+crypto.randomBytes(32).toString('hex');
try{
 const file=path.join(root,'drafts-SANDBOX.json');
 const android=makeDraftStore({filePath:file});
 let cart=android.mutate(token,[{action:'add',code:'TP-00003',qty:1}],0);
 ok(cart.revision===1&&cart.items.length===1,'Android adds a product');
 const browser=makeDraftStore({filePath:file});
 ok(browser.read(token).revision===1,'Web session reads same server revision');
 cart=browser.mutate(token,[{action:'add',code:'TP-00136',qty:2}],1);
 ok(cart.revision===2&&cart.items.length===2,'Web adds to same shared basket');
 ok(!fs.readFileSync(file,'utf8').includes(token),'no bearer link credential persisted');
 const restarted=makeDraftStore({filePath:file});
 ok(restarted.read(token).revision===2&&restarted.read(token).items.length===2,
    'restart recovers both products and revision');
 assert.throws(()=>restarted.mutate(token,[{action:'set',code:'TP-00003',qty:10}],1),/DRAFT_CONFLICT/);n++;
 ok(restarted.read('unrelated-test-link').items.length===0,'isolation across customer links');
 const archive=createSandboxBackup({orders:[],profiles:[],changeRequests:[],drafts:restarted.snapshot()});
 const verify=verifySandboxBackup(archive);
 ok(verify.drafts.length===1&&archive.snapshot.drafts[0].items.length===2,'pending basket in verified backup');
 const key=crypto.randomBytes(32),encrypted=encryptArchive(archive,key);
 ok(!JSON.stringify(encrypted).includes(token)&&
    !JSON.stringify(encrypted).includes('TP-00003'),'Drive sees ciphertext only');
 const remote=decryptArchive(encrypted,key);
 const recovered=makeDraftStore({filePath:path.join(root,'remote.json')});
 recovered.restore(remote.drafts);
 ok(recovered.read(token).revision===2&&recovered.read(token).items.length===2,
    'Drive recovery keeps pending basket');
 const tampered=structuredClone(archive);
 tampered.snapshot.drafts[0].token=token;
 tampered.checksum=crypto.createHash('sha256').update(JSON.stringify(tampered.snapshot)).digest('hex');
 assert.throws(()=>verifySandboxBackup(tampered),/INVALID_SANDBOX_BACKUP/);n++;
 const cleared=restarted.mutate(token,[{action:'clear'}],2);
 ok(cleared.items.length===0,'checkout can clear one shared basket');
 const reloaded=makeDraftStore({filePath:file});
 ok(reloaded.read(token).revision===3&&reloaded.read(token).items.length===0,
    'clear state persisted; no phantom second checkout');
 const legacy=structuredClone(archive);
 delete legacy.snapshot.drafts;
 legacy.checksum=crypto.createHash('sha256').update(JSON.stringify(legacy.snapshot)).digest('hex');
 ok(verifySandboxBackup(legacy).drafts.length===0,'v1 archives without drafts still restore');
 const corrupt=path.join(root,'corrupt.json');fs.writeFileSync(corrupt,'{');
 assert.throws(()=>makeDraftStore({filePath:corrupt}));n++;
 console.log('PASS '+n+'/'+n+' persistent cross-device shared cart, conflict, encrypted backup, restore');
}finally{fs.rmSync(root,{recursive:true,force:true})}
