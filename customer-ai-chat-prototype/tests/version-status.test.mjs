import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {compareVersion,getGeminiVersionStatus} from '../version-status.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
let count=0;function ok(value,message){assert.ok(value,message);count++}
const stable='a'.repeat(40),newer='b'.repeat(40);
ok(compareVersion(stable,stable)==='up_to_date','same full SHA means up-to-date');
ok(compareVersion(stable,newer)==='update_available','GitHub newer detected');
ok(compareVersion('',newer)==='unverified','unknown runtime cannot be marked current');
ok(compareVersion(stable,'')==='unverified','offline GitHub cannot be marked current');
ok(compareVersion(stable,stable.slice(0,12))==='up_to_date','short Git SHA recognized');
let calls=0;
const fakeFetcher=async(url,options)=>{
 calls++;
 ok(url.startsWith('https://api.github.com/repos/nguyenkhoilevn7-acetropical/Minhsatori/branches/'),
  'fixed public GitHub endpoint only');
 ok(options.method==='GET','version check cannot write');
 return {ok:true,json:async()=>({commit:{sha:newer}})};
};
const got=await getGeminiVersionStatus({env:{RENDER_GIT_COMMIT:stable},
  fetcher:fakeFetcher,now:1000,cache:false});
ok(got.gemini.state==='update_available','deployed older than Github');
ok(got.gemini.githubCommit===newer,'GitHub SHA returned');
ok(got.website.state==='not_verified'&&got.android.state==='not_verified',
 'does not pretend untested website or APK is synced');
ok(calls===1,'one read-only fetch');
const unreachable=await getGeminiVersionStatus({env:{RENDER_GIT_COMMIT:stable},
 fetcher:async()=>{throw Error('mock offline')},now:2000,cache:false});
ok(unreachable.gemini.state==='unverified','network failures reported as unverified');
const admin=fs.readFileSync(path.join(here,'../admin.html'),'utf8');
const server=fs.readFileSync(path.join(here,'../server.mjs'),'utf8');
ok(admin.includes('Phiên bản hệ thống')&&admin.includes('/api/admin/version-status'),
 'admin UI provides version panel');
ok(server.includes("p==='/api/admin/version-status'")&&server.includes('customerLinks.adminAuthorized(req)'),
 'version route protected by admin authorization');
console.log('PASS '+count+'/'+count+' Gemini version detection, auth and UI checks (no network)');
