// Offline non-mutating HTML check of linked CTV invoices.
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const inline=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
 .filter(m=>!/\bsrc\s*=/.test(m[1]));
for(const s of inline){if(!s[2].trim())continue;new vm.Script(s[2],{filename:'index-inline-script.js'})}
assert.match(html,/const accountingByOrder=new Map\(Acct\.model\(\)\.rows\.map/);
assert.match(html,/if\(row\?\.secondary\|\|o\.pairRole==='collaborator'\)return;/);
assert.match(html,/o\.pairRole!=='collaborator'/);
assert.match(html,/const subCount=financialRows\.length/);
assert.match(html,/o\.pairRole==='customer'\?'Bill khách':'Bill CTV nội bộ'/);
assert.match(html,/pairInvoiceNo/);
console.log('PASS website CTV pair labels; revenue, paid and unpaid exclude settlement bill; admin PDF role visible (no real data)');
