// Offline, source-preserving update of the three live PDF version contracts.
const fs=require('node:fs'),path=require('node:path'),acorn=require('acorn');
function functions(source){const out=[];function walk(n){if(!n||typeof n!=='object')return;if(n.type==='FunctionDeclaration')out.push(n);for(const v of Object.values(n))if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}walk(acorn.parse(source,{ecmaVersion:'latest'}));return out;}
function portFiles(files){
 const output={};
 for(const [name,fn,suffix] of [['InvoicePdfArchive.gs','canonical','suffix'],['InvoicePdfPendingReadOnly.gs','canonical','TEMPLATE'],['InvoicePdfCustomerRead.gs','originalVersion','template']]){
  const source=files[name];if(typeof source!=='string')throw Error('Missing '+name);
  const matches=functions(source).filter(n=>n.id.name===fn);if(matches.length!==1)throw Error('Ambiguous '+fn);
  const node=matches[0],body=source.slice(node.start,node.end);
  // Refuse an unknown live version layout instead of silently changing its key.
  const returned=node.body.body.find(n=>n.type==='ReturnStatement')?.argument;
  const array=returned?.left?.left?.arguments?.[0];
  const expected=['invoiceNo','date','name','phone','location','deliveryNote','taxCode','status','items','product','qty','listPrice','unitPrice','vat','vatAmount','shippingAmount'];
  if(array?.type!=='ArrayExpression'||JSON.stringify(array.elements.map(n=>n.object?.name==='o'?n.property?.name:null))!==JSON.stringify(expected))throw Error('Unknown historical PDF key: '+name);
  const replacement='function '+fn+'(o){\n var fields=['+expected.map(k=>'o.'+k).join(',')+'];\n if(o.vatMode===\'per_line\')fields.push(o.vatMode,o.vatRate);\n return JSON.stringify(fields)+\'\\n\'+'+suffix+';\n}';
  let changed=source.slice(0,node.start)+replacement+source.slice(node.end);
  if(name==='InvoicePdfPendingReadOnly.gs'){
   const marker='jobs.push({order:safe,versionKey:versionKey});';
   if(changed.split(marker).length!==2)throw Error('Unknown queue projection');
   changed=changed.replace(marker,"if(o.vatMode==='per_line'){safe.vatMode=o.vatMode;if(o.vatRate!==undefined)safe.vatRate=o.vatRate;}\n"+marker);
  }
  acorn.parse(changed,{ecmaVersion:'latest'});output[name]=changed;
 }
 return output;
}
module.exports={portFiles,functions};
if(require.main===module){const [input,dir]=process.argv.slice(2);if(!input||!dir)throw Error('Use backup JSON and output directory');const backup=JSON.parse(fs.readFileSync(input,'utf8'));fs.mkdirSync(dir,{recursive:true});for(const [name,s]of Object.entries(portFiles(backup.files)))fs.writeFileSync(path.join(dir,name),s,{mode:0o600});console.log('Ported three PDF contracts; historical keys preserved; no deployment or ledger access.');}
