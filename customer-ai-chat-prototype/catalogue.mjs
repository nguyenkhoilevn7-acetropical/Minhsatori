/**
 * Safe offline fallback imported from Minh Satori website's 20-item DEFAULT_CATALOGUE.
 * No customer data. Real catalogue edits require authenticated read-only sync before launch.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const initial=JSON.parse(fs.readFileSync(path.join(here,'catalogue.json'),'utf8'));
export const CATALOGUE=Object.freeze(initial.items.map(item=>Object.freeze({...item})));
const byCode=new Map(CATALOGUE.map(x=>[x.code,x]));
const ALIASES=Object.freeze({S5L:'TP-00136',S500:'TP-00003',S350:'TP-00001'});
export function productFor(code){return byCode.get(ALIASES[code]||code)||null}
export function productList(){return CATALOGUE.map(x=>({code:x.code,name:x.name,brand:x.brand,unit:x.unit,spec:x.spec}))}
export function fold(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/đ/g,'d').replace(/\s+/g,' ').trim()}
function has(n,pat){return new RegExp('(?:^|[^a-z0-9])(?:'+pat+')(?![a-z0-9])').test(n)}
export function resolveProduct(text,profile={}){
 const n=fold(text);
 const explicit=n.match(/\btp[- ]?(\d{5})\b/);
 if(explicit)return byCode.has('TP-'+explicit[1])?{sku:'TP-'+explicit[1]}:{sku:null,ambiguous:true};
 const premium=has(n,'premium|450\\s*ml');
 if(premium){
  if(has(n,'500\\s*ml|350\\s*ml|1500\\s*ml|1[,.]?5\\s*l|19\\s*l|20\\s*l'))return {sku:null,ambiguous:true};
  return {sku:'TP-00051'};
 }
 const juice=has(n,'juice|nuoc ep|ep me|ep mang cau|ep oi|mang cau|oi hong');
 if(juice){
  if(has(n,'mang cau|man cau'))return {sku:'TP-00056'};
  if(has(n,'oi hong|oi'))return {sku:'TP-00058'};
  if(has(n,'me'))return {sku:'TP-00055'};
  return {sku:null,ambiguous:true};
 }
 const hikari=has(n,'hikari'),satori=has(n,'satori');
 if(hikari&&satori)return {sku:null,ambiguous:true};
 const size5=has(n,'5\\s*l'),size19=has(n,'19\\s*l'),size20=has(n,'20\\s*l'),size1500=has(n,'1500\\s*ml|1[,.]5\\s*l'),size500=has(n,'500\\s*ml'),size350=has(n,'350\\s*ml'),size250=has(n,'250\\s*ml');
 const sizes=[size5,size19,size20,size1500,size500,size350,size250].filter(Boolean).length;
 if(sizes>1)return {sku:null,ambiguous:true};
 const spoutOff=has(n,'khong voi|ko voi|k voi|binh up'),spoutOn=has(n,'co voi'),bottle=has(n,'binh|binh le');
 const carton=has(n,'thung|thg');
 if(hikari){
  if(size500)return {sku:'TP-00081'};
  if(size19)return {sku:'TP-00130'};
  if(size250){
    if(has(n,'6\\s*chai'))return {sku:'TP-00138'};
    if(has(n,'12\\s*chai'))return {sku:'TP-00139'};
    if(has(n,'24\\s*chai')&&has(n,'loc'))return {sku:'TP-00140'};
    if(has(n,'loc'))return {sku:null,ambiguous:true};
    if(carton)return {sku:'TP-00137'};
    return {sku:null,ambiguous:true};
  }
  return {sku:null,ambiguous:true};
 }
 if(size500)return {sku:!hikari?'S500':null};
 if(size350)return {sku:'S350'};
 if(size1500)return {sku:'TP-00004'};
 if(size20)return {sku:'TP-00005'};
 if(size19){
  if(spoutOn&&!spoutOff)return {sku:'TP-00033'};
  if(spoutOff&&!spoutOn)return {sku:'TP-00096'};
  return {sku:null,ambiguous:true};
 }
 if(size5){
  if(spoutOn&&spoutOff)return {sku:null,ambiguous:true};
  if(bottle&&!carton)return {sku:spoutOn?'TP-00142':spoutOff?'TP-00143':null,ambiguous:!spoutOn&&!spoutOff};
  if(spoutOn)return {sku:'S5L'};
  if(spoutOff)return {sku:'TP-00135'};
  if(profile.uniqueFavourite && productFor(profile.favourite)?.name.includes('5L'))return {sku:profile.favourite};
  return {sku:null,ambiguous:true};
 }
 if(has(n,'premium'))return {sku:'TP-00051'};
 return {sku:null,ambiguous:false};
}
