/**
 * ADMIN-ONLY, READ-ONLY readiness audit for the canonical Drive ledger catalogue.
 * This module NEVER creates/changes customer profiles, payments or invoices.
 * It deliberately refuses missing/stale Drive data instead of trusting the
 * Gemini demo snapshot or browser localStorage as the price authority.
 */
import {checkCatalogueParity} from './catalogue-parity.mjs';

function fail(code){ const e=new Error(code);e.code=code;throw e }
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const sku=/^TP-[0-9]{5}$/;
const safePrice=x=>Number.isSafeInteger(x)&&x>=0&&x<=1_000_000_000;
const text=x=>typeof x==='string'&&x.trim().length>0&&x.length<=160;
const FIELDS=['name','unit','spec','listPrice'];

function validateProducts(products){
 if(!Array.isArray(products)||products.length<1||products.length>300) fail('INVALID_SOURCE_PRODUCTS');
 const codes=new Set();
 for(const p of products){
  if(!p||typeof p!=='object'||Array.isArray(p)||!sku.test(p.code||'')||codes.has(p.code))
   fail('INVALID_SOURCE_PRODUCTS');
  codes.add(p.code);
  if(!text(p.name)||!text(p.unit)||!text(p.spec)||!safePrice(p.listPrice))
   fail('INVALID_SOURCE_PRODUCTS');
 }
}

/**
 * Inputs are already HMAC-authorized, server-fetched responses from two
 * READ-ONLY Bot actions. Revisions MUST match, even if prices look identical.
 * Return admin-safe product differences only: never forward raw API responses.
 */
export function auditDriveCatalogue(status,catalogue,demo){
 if(!Number.isSafeInteger(status?.revision)||status.revision<1||
    !Number.isSafeInteger(catalogue?.revision)||catalogue.revision!==status.revision)
  fail('SOURCE_REVISION_MISMATCH');
 if(catalogue.data?.source!=='drive-ledger:satori_catalogue_v15'||
    (own(catalogue.data??{},'revision')&&catalogue.data.revision!==status.revision))
  fail('SOURCE_NOT_CANONICAL');
 const products=catalogue.data?.products;
 validateProducts(products);
 validateProducts(demo);
 const parity=checkCatalogueParity(products,demo);
 const byDrive=new Map(products.map(p=>[p.code,p])),byDemo=new Map(demo.map(p=>[p.code,p]));
 const items=[];
 for(const code of new Set([...byDrive.keys(),...byDemo.keys()])){
  const d=byDrive.get(code),g=byDemo.get(code);
  if(!d||!g){
   items.push({code,kind:d?'DRIVE_ONLY':'GEMINI_ONLY',
    driveListPrice:d?.listPrice??null,geminiListPrice:g?.listPrice??null});
   continue;
  }
  const changedFields=FIELDS.filter(k=>d[k]!==g[k]);
  if(changedFields.length)items.push({
   code,kind:'CHANGED',changedFields,
   driveListPrice:d.listPrice,geminiListPrice:g.listPrice,
   driveName:d.name,geminiName:g.name
  });
 }
 items.sort((a,b)=>a.code.localeCompare(b.code));
 return Object.freeze({
  revision:status.revision,
  catalogueSource:'drive-ledger:satori_catalogue_v15',
  sourceCount:products.length,geminiCount:demo.length,
  exactlyMatched:parity.exactlyMatched,
  matchedCount:parity.matchedCount,
  differences:items,
  /* Matching is only a prerequisite; no real checkout or write is enabled. */
  eligibleForReadOnlyIntegration:parity.exactlyMatched,
  checkoutEnabled:false,
  customerSync:false,
  productionWriteEnabled:false
 });
}
