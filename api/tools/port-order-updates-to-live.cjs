#!/usr/bin/env node
// Offline source transformation. Never fetches, deploys, reads secrets or edits a ledger.
// npm install --prefix <temporary-tools> acorn@8; NODE_PATH=<temporary-tools>/node_modules
// node api/tools/port-order-updates-to-live.cjs <live-source> <new-file>
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const acorn=require('acorn');
const root=path.resolve(__dirname,'../..');
const baseline='e8ab21c4';
function inspect(source){
 const functions=new Map(),variables=new Map();
 function walk(n){if(!n||typeof n!=='object')return;
  if(n.type==='FunctionDeclaration'){
   if(functions.has(n.id.name))throw Error('Duplicate function: '+n.id.name);
   functions.set(n.id.name,n);
  }
  if(n.type==='VariableDeclarator'&&n.id?.name==='SCOPES')variables.set('SCOPES',n.init);
  for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}
 }walk(acorn.parse(source,{ecmaVersion:'latest'}));return {functions,variables};
}
const canonical=n=>JSON.stringify(n,(k,v)=>['start','end','raw'].includes(k)?undefined:v);
function port(live,next,base){
 const l=inspect(live),n=inspect(next),b=inspect(base),edits=[];
 const take=(source,map,name)=>{const f=map.get(name);if(!f)throw Error('Missing function: '+name);return source.slice(f.start,f.end)};
 const replace=(name,content)=>{const f=l.functions.get(name);if(!f)throw Error('Live function absent: '+name);edits.push([f.start,f.end,content]);};
 for(const name of ['auth','updateUnpaidOrder']){
  if(canonical(l.functions.get(name))!==canonical(b.functions.get(name)))throw Error('PORT_REFUSED: changed live '+name);
  replace(name,take(next,n.functions,name));
 }
 const helpers=['exactEditOrder','editAudit','unusedEditRequest','normalizeEditPrices','undoOrderUpdate'];
 for(const name of helpers)if(l.functions.has(name))throw Error('PORT_REFUSED: helper already exists: '+name);
 const at=l.functions.get('updateUnpaidOrder').start;
 edits.push([at,at,helpers.map(name=>take(next,n.functions,name)).join('\n')+'\n']);
 // Inject only the new read routes; preserve live pdf.get, getExactBatch and others.
 const read=take(live,l.functions,'read'),newRead=take(next,n.functions,'read');
 const boundary=newRead.indexOf(" if(action==='links.list')");
 if(boundary<0)throw Error('PORT_REFUSED: new read boundary absent');
 const prefix=newRead.slice(newRead.indexOf('{')+1,boundary);
 replace('read',read.slice(0,read.indexOf('{')+1)+prefix+read.slice(read.indexOf('{')+1));
 const once=(source,re,replacement)=>{
  const hits=[...source.matchAll(new RegExp(re.source,'g'))];if(hits.length!==1)throw Error('PORT_REFUSED: expected one '+re);
  return source.replace(re,replacement);
 };
 let write=take(live,l.functions,'write');
 write=once(write,/function write\(s,action,p\)/,'function write(s,action,p,actor)');
 // The mobile entry point already enforces the live retirement policy. Apply
 // the same policy to the new HMAC entry point before any order mutation.
 write=once(write,/function write\(s,action,p,actor\)\{/,
  "function write(s,action,p,actor){\n if(action==='orders.update'&&typeof guardRetiredOrderEdit_==='function')guardRetiredOrderEdit_(s,action,p);");
 write=once(write,/action==='orders.update'\?updateUnpaidOrder\(s,all,p\):/,"action==='orders.update'?updateUnpaidOrder(s,all,p,actor):\n action==='orders.undoUpdate'?undoOrderUpdate(s,all,p,actor):");replace('write',write);
 let handle=take(live,l.functions,'handle');
 handle=once(handle,/var result=isWrite\?write\(s,identity.action,identity.payload\)/,"isWrite=isWrite||identity.action==='orders.update'||identity.action==='orders.undoUpdate';\n var result=isWrite?write(s,identity.action,identity.payload,identity.actor)");replace('handle',handle);
 const scopes=l.variables.get('SCOPES');if(!scopes||scopes.type!=='ObjectExpression')throw Error('PORT_REFUSED: SCOPES absent');
 const additions=['orders.get','orders.auditHistory','orders.capabilities','orders.previewUpdate','orders.update','orders.undoUpdate'];
 if(scopes.properties.some(p=>additions.includes(p.key.value)))throw Error('PORT_REFUSED: action already exists');
 edits.push([scopes.start+1,scopes.start+1,"'orders.get':'orders:read','orders.auditHistory':'orders:read','orders.capabilities':'orders:update','orders.previewUpdate':'orders:update','orders.update':'orders:update','orders.undoUpdate':'orders:update',"]);
 let output=live;for(const [start,end,text] of edits.sort((a,b)=>b[0]-a[0]||b[1]-a[1]))output=output.slice(0,start)+text+output.slice(end);
 const out=inspect(output),changed=new Set(['auth','read','write','handle','updateUnpaidOrder']);
 for(const [name,node]of l.functions)if(!changed.has(name)&&canonical(node)!==canonical(out.functions.get(name)))throw Error('PORT_REFUSED: unrelated function changed: '+name);
 return output;
}
module.exports={port};
if(require.main===module){
 const [input,output]=process.argv.slice(2);if(!input||!output||path.resolve(input)===path.resolve(output))throw Error('Use different input/output paths');
 const base=cp.execFileSync('git',['show',baseline+':api/BotApi.gs'],{cwd:root,encoding:'utf8'});
 const result=port(fs.readFileSync(input,'utf8'),fs.readFileSync(path.join(root,'api/BotApi.gs'),'utf8'),base);
 fs.writeFileSync(output,result,{mode:0o600});console.log('Ported edit routes; unrelated live functions preserved. No deployment performed.');
}
