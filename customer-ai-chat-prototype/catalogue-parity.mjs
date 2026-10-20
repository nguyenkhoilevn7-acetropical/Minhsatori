/** Read-only, no PII: compare a versioned source-of-truth product catalogue
 * against the frozen Gemini demo catalogue before any live checkout migration.
 * Product prices are NOT returned to browsers by the admin integration probe.
 */
const fields=['name','unit','spec','listPrice'];
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
export function checkCatalogueParity(source,demo){
 if(!Array.isArray(source)||!Array.isArray(demo)||source.length>300||demo.length>300)
  throw Error('INVALID_CATALOGUE_COMPARE');
 const src=new Map(),dst=new Map();
 for(const [list,m] of [[source,src],[demo,dst]]){
  for(const p of list){
   if(!p||typeof p!=='object'||Array.isArray(p)||typeof p.code!=='string'||
      !/^TP-[0-9]{5}$/.test(p.code)||m.has(p.code))
    throw Error('INVALID_CATALOGUE_CODE');
   for(const key of fields)if(!own(p,key)||p[key]===null||p[key]===undefined)
    throw Error('INVALID_CATALOGUE_FIELD');
   if(!Number.isSafeInteger(Number(p.listPrice))||Number(p.listPrice)<0)
    throw Error('INVALID_CATALOGUE_PRICE');
   m.set(p.code,p);
  }
 }
 const missing=[],extra=[],changed=[];
 for(const [code,p] of src){
  if(!dst.has(code)){missing.push(code);continue}
  const q=dst.get(code);
  if(fields.some(k=>String(p[k])!==String(q[k])))changed.push(code);
 }
 for(const code of dst.keys())if(!src.has(code))extra.push(code);
 missing.sort();extra.sort();changed.sort();
 return Object.freeze({
  sourceCount:src.size,localCount:dst.size,matchedCount:src.size-missing.length-changed.length,
  missingCodes:missing,extraCodes:extra,changedCodes:changed,
  exactlyMatched:missing.length===0&&extra.length===0&&changed.length===0&&src.size>0
 });
}
