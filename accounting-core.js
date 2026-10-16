(function(root){
'use strict';
const key=o=>String(o.__syncId||String(o.id)+'|'+String(o.invoiceNo));
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase().replace(/[^a-z0-9/]+/g,' ').trim().replace(/\s+/g,' ');
const number=v=>Number.isFinite(Number(v))?Number(v):0;
const active=o=>!['Đã hủy','Không Tính'].includes(o.status);
const paid=o=>o.status==='Đã thanh toán'||!!o.customerPaidAt;
const items=o=>o.items?.length?o.items:[o];
const goods=o=>items(o).reduce((s,i)=>s+number(i.qty)*number(i.unitPrice),0);
const listed=o=>items(o).reduce((s,i)=>s+number(i.qty)*number(i.listPrice),0);
const total=o=>o.total!==undefined?number(o.total):goods(o)+number(o.shippingAmount)+number(o.vatAmount);
function basket(o){
 const map=new Map();
 for(const i of items(o)){
  const key=norm(i.code||i.product||i.name)+'|'+norm(i.unit||'Thùng');
  if(!key.split('|')[0]||number(i.qty)<=0)return '';
  map.set(key,(map.get(key)||0)+number(i.qty));
 }
 return JSON.stringify([...map].sort((a,b)=>a[0].localeCompare(b[0])));
}
function pairOrders(all){
 const groups=new Map(),pairs=[],review=[],byId=new Map();
 for(const o of all.filter(active)){
  const name=norm(o.name),b=basket(o);
  if(!name||['khach vang lai','khach zalo'].includes(name)||!b)continue;
  const key=name+'|'+b;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(o);
 }
 for(const rows of groups.values()){
  if(rows.length<2)continue;
  if(rows.length!==2){review.push({orders:rows,reason:'Có nhiều hơn 2 đơn cùng người nhận và giỏ hàng; chưa tự ghép để tránh trả lời trùng.'});continue;}
  const [a,b]=rows;
  if(norm(a.location)&&norm(b.location)&&norm(a.location)!==norm(b.location)){review.push({orders:rows,reason:'Cùng tên và hàng nhưng khác địa chỉ giao.'});continue;}
  if(a.collaboratorId&&b.collaboratorId&&a.collaboratorId!==b.collaboratorId){review.push({orders:rows,reason:'Hai đơn thuộc hai cộng tác viên khác nhau.'});continue;}
  if(total(a)===total(b)){review.push({orders:rows,reason:'Hai hóa đơn bằng tiền; không phát sinh chênh lệch, cần kiểm tra trùng đơn.'});continue;}
  const high=total(a)>total(b)?a:b,low=high===a?b:a;
  const p={id:key(high)+'::'+key(low),high,low,profit:Math.round(total(high)-total(low)),collaboratorId:high.collaboratorId||low.collaboratorId||'',basis:'Giá trị hóa đơn cao − thấp (gồm VAT/ship theo hóa đơn)'};
  pairs.push(p);byId.set(key(high),p);byId.set(key(low),p);
 }
 return {pairs,review,byId};
}
function calculate(all,partners){
 const pairing=pairOrders(all),partnersById=new Map(partners.map(p=>[String(p.id),p]));
 const uncertain=new Set(pairing.review.flatMap(x=>x.orders.map(o=>key(o))));
 const rows=all.map(o=>{
  const pair=pairing.byId.get(key(o)),secondary=pair?.low===o;
  const partnerId=pair?.collaboratorId||o.collaboratorId||'',partner=partnersById.get(String(partnerId));
  const discount=number(o.collaboratorDiscountPercent??partner?.discountPercent);
  const base=Math.round(listed(o)*(1-discount/100));
  const raw=pair?(secondary?0:pair.profit):partnerId?Math.round(goods(o)-base):0;
  const eligible=active(o)&&!secondary&&!uncertain.has(key(o));
  const profit=eligible?raw:0,settled=number(o.collaboratorPaid);
  return {order:o,pair,secondary,partnerId,partner,discount,base,eligible,review:uncertain.has(key(o)),profit,settled,due:eligible?Math.max(0,profit-settled):0,customerPaid:paid(o),satoriPaid:o.status==='Đã TT Satori'||!!o.satoriPaidAt,basis:pair?pair.basis:partnerId?'Tiền hàng bán − giá niêm yết × (1 − CK CTV); không gồm VAT/ship':'Chưa gắn cộng tác viên'};
 });
 return {...pairing,rows,partners:partners.map(p=>{const pr=rows.filter(r=>r.partnerId===p.id&&r.eligible);return {...p,count:pr.length,profit:pr.reduce((s,r)=>s+r.profit,0),settled:pr.reduce((s,r)=>s+r.settled,0),due:pr.reduce((s,r)=>s+r.due,0)};})};
}
// Reconciliation only: accent-insensitive keyword overlap, with a house-number guard.
function addressSimilarity(left,right){
 const prepare=value=>{
  let text=norm(value).replace(/\b([pq])(?=\d)/g,'$1 ').replace(/\b(?:tp\s*)?ho chi minh\b|\btp\s*hcm\b|\btphcm\b|\bhcm\b|\bviet nam\b/g,' ')
   .replace(/\b(?:thanh pho|thi xa|thi tran|quan|huyen|phuong|xa|tp|q|p)\b.*$/,' ')
   .replace(/\b(?:thanh pho|thi xa|thi tran|quan|huyen|phuong|xa|tp|q|p|duong|street|so|dia chi|viet nam)\b/g,' ')
   .replace(/\//g,' ').replace(/\s+/g,' ').trim();
  const house=text.match(/^(?:hem\s+|ngo\s+)?(\d+[a-z]?(?:\s+\d+[a-z]?)*)(?=\s|$)/)?.[1]||'';
  return {house,tokens:[...new Set(text.split(' ').filter(Boolean))]};
 };
 const a=prepare(left),b=prepare(right),common=a.tokens.filter(t=>b.tokens.includes(t));
 const score=a.tokens.length&&b.tokens.length?2*common.length/(a.tokens.length+b.tokens.length):0;
 const houseConflict=!!a.house&&!!b.house&&a.house!==b.house;
 const words=common.filter(t=>/[a-z]/.test(t));
 const sufficient=words.length>=2 || (words.length>=1&&common.some(t=>/^\d/.test(t))) || (!!a.house&&a.house===b.house&&common.length>=2);
 return {score,percent:Math.round(score*100),common,houseConflict,matched:score>=0.45&&sufficient&&!houseConflict};
}
function identityMatch(companies,locals){
 const key=v=>norm(v).replace(/^hd\s*/,'').replace(/\s/g,'').replace(/^0+(?=\d)/,'');
 const codes=d=>[d.ref,d.invoice,...(d.rows||[]).flatMap(r=>[r.invoice,r.ref])].map(key).filter(Boolean);
 const matchedLocal=new Set();
 const rows=companies.map(a=>{
  const ac=codes(a);
  const comparisons=locals.map((b,j)=>{const similarity=addressSimilarity(a.address,b.address);return {b,j,code:ac.some(c=>codes(b).includes(c)),address:similarity.matched,similarity};});
  const candidates=comparisons.filter(x=>x.code||x.address);
  candidates.forEach(x=>matchedLocal.add(x.j));
  const unique=candidates.length===1?candidates[0].b:null;
  const basis=[...new Set(candidates.flatMap(x=>[x.code?'mã hóa đơn':'',x.address?'từ khóa địa chỉ ≥45%':'']).filter(Boolean))];
  const evidence=candidates.filter(x=>x.address).map(x=>'HĐ '+(x.b.invoice||x.b.ref||'nội bộ')+': '+x.similarity.percent+'% · từ trùng: '+x.similarity.common.join(', '));
  return {company:a.rows||[],local:candidates.flatMap(x=>x.b.rows||[]),source:a,companyAmount:a.amount??null,localAmount:unique?.amount??null,delta:unique&&a.amount!=null&&unique.amount!=null?a.amount-unique.amount:null,status:candidates.length?'Khớp':'Không khớp',category:candidates.length?'matched':'unmatched',basis,addressMatches:candidates.filter(x=>x.address).map(x=>({invoice:x.b.invoice||x.b.ref||'',percent:x.similarity.percent,common:x.similarity.common})),detail:candidates.length?'Khớp '+basis.join(' hoặc ')+'. '+evidence.join('; ')+(candidates.length>1?' · Có '+candidates.length+' hóa đơn nội bộ phù hợp; liệt kê tất cả, không tự bù trừ tiền.':'')+(a.error?' · Dữ liệu phụ: '+a.error:''):'Không có mã hóa đơn trùng hoặc địa chỉ đạt 45% từ khóa phù hợp. Địa chỉ khác số nhà không tự ghép. Tên, SĐT, ngày, hàng, số lượng và tiền không quyết định kết quả.'};
 });
 locals.forEach((b,j)=>{if(!matchedLocal.has(j))rows.push({company:[],local:b.rows||[],source:null,companyAmount:null,localAmount:b.amount??null,delta:null,status:'Chưa có trong Excel',category:'localOnly',basis:[],detail:'Đơn nội bộ không có mã hoặc từ khóa địa chỉ khớp trong Excel (ngưỡng 45%).'});});
 return rows;
}
root.SatoriAccountingCore={key,norm,number,active,paid,items,goods,listed,total,basket,pairOrders,calculate,addressSimilarity,identityMatch};
})(typeof window!=='undefined'?window:globalThis);
