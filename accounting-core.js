(function(root){
'use strict';
const key=o=>String(o.__syncId||String(o.id)+'|'+String(o.invoiceNo));
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase().replace(/[^a-z0-9/]+/g,' ').trim().replace(/\s+/g,' ');
const number=v=>Number.isFinite(Number(v))?Number(v):0;
const active=o=>!['Đã hủy','Không Tính'].includes(o.status);
const statusClass=o=>({'Đã TT Satori':'text-emerald-400','Đã thanh toán':'text-emerald-400','Chưa thanh toán':'text-amber-400','Không Tính':'text-indigo-400','Đã hủy':'text-rose-400'}[o.status]||'text-slate-400')+' font-semibold';
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
 const groups=new Map(),explicit=new Map(),pairs=[],review=[],byId=new Map();
 const explicitRows=new Set();
 const pairEntry=(high,low,basis)=>{
  const p={id:key(high)+'::'+key(low),high,low,
   profit:Math.round(total(high)-total(low)),
   collaboratorId:high.collaboratorId||low.collaboratorId||'',basis};
  pairs.push(p);byId.set(key(high),p);byId.set(key(low),p);
 };
 // Explicit, server-created pairs MUST be matched by immutable group ID,
 // never guessed by name + basket (two orders on the same day can be identical).
 for(const o of all){
  if(typeof o.pairGroupId!=='string'||!/^pair_[a-zA-Z0-9-]{16,80}$/.test(o.pairGroupId))continue;
  explicitRows.add(key(o));
  if(!explicit.has(o.pairGroupId))explicit.set(o.pairGroupId,[]);
  explicit.get(o.pairGroupId).push(o);
 }
 for(const rows of explicit.values()){
  const customer=rows.find(x=>x.pairRole==='customer');
  const settlement=rows.find(x=>x.pairRole==='collaborator');
  const valid=rows.length===2&&customer&&settlement&&
   active(customer)&&active(settlement)&&
   customer.collaboratorId===settlement.collaboratorId&&
   !!customer.collaboratorId&&
   String(customer.pairInvoiceNo)===String(settlement.invoiceNo)&&
   String(settlement.pairInvoiceNo)===String(customer.invoiceNo)&&
   customer.pairPolicyVersion===settlement.pairPolicyVersion&&
   norm(settlement.pairCustomerName||settlement.name)===norm(customer.name)&&
   norm(customer.pairCollaboratorName||settlement.name)===norm(settlement.name)&&
   norm(customer.location)===norm(settlement.location)&&
   basket(customer)===basket(settlement)&&
   total(customer)>total(settlement);
  if(!valid){review.push({orders:rows,reason:'Cặp hóa đơn CTV có trạng thái hoặc dữ liệu sai, cần rà soát thủ công.'});continue;}
  pairEntry(customer,settlement,'Hai bill chung mã liên kết, khách trả giá cao, bill CTV đối soát (gồm phí/thuế theo từng bill)');
 }
 for(const o of all.filter(active)){
  // Rows carrying a pair marker are NEVER sent to legacy heuristic matching,
  // even if the other half is deleted, cancelled or the pair is malformed.
  if(explicitRows.has(key(o)))continue;
  const name=norm(o.name),b=basket(o);
  if(!name||['khach vang lai','khach zalo'].includes(name)||!b)continue;
  const group=name+'|'+b;if(!groups.has(group))groups.set(group,[]);
  groups.get(group).push(o);
 }
 for(const rows of groups.values()){
  if(rows.length<2)continue;
  if(rows.length!==2){review.push({orders:rows,reason:'Có nhiều hơn 2 đơn cùng người nhận và giỏ hàng; chưa tự ghép để tránh trả lời trùng.'});continue;}
  const [a,b]=rows;
  if(norm(a.location)&&norm(b.location)&&norm(a.location)!==norm(b.location)){review.push({orders:rows,reason:'Cùng tên và hàng nhưng khác địa chỉ giao.'});continue;}
  if(a.collaboratorId&&b.collaboratorId&&a.collaboratorId!==b.collaboratorId){review.push({orders:rows,reason:'Hai đơn thuộc hai cộng tác viên khác nhau.'});continue;}
  if(total(a)===total(b)){review.push({orders:rows,reason:'Hai hóa đơn bằng tiền; không phát sinh chênh lệch, cần kiểm tra trùng đơn.'});continue;}
  const high=total(a)>total(b)?a:b,low=high===a?b:a;
  pairEntry(high,low,'Giá trị hóa đơn cao − thấp (gồm VAT/ship theo hóa đơn)');
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
// Group imported Satori lines before matching. Invoice and order IDs have separate namespaces.
function groupCompanyRows(rows){
 const parents=rows.map((_,i)=>i),seen=new Map();
 const find=i=>parents[i]===i?i:(parents[i]=find(parents[i]));
 const code=v=>{const s=String(v??'').trim().toUpperCase().replace(/\s+/g,' ');return /^(?:|0|-|N\/A|NULL|KHONG CO)$/.test(s)?'':s;};
 rows.forEach((r,i)=>{
  const ids=[code(r.invoice)&&'invoice:'+code(r.invoice),code(r.ref)&&'order:'+code(r.ref)].filter(Boolean);
  if(!ids.length&&code(r.doc))ids.push('document:'+code(r.doc));
  for(const id of ids){if(seen.has(id))parents[find(i)]=find(seen.get(id));else seen.set(id,i);}
 });
 const groups=new Map();rows.forEach((r,i)=>{const k=find(i);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);});
 return [...groups.values()].map((list,i)=>{const unique=f=>[...new Set(list.map(r=>code(r[f])).filter(Boolean))];const invoices=unique('invoice'),refs=unique('ref');return {id:invoices.length?'invoice:'+invoices[0]:refs.length?'order:'+refs[0]:'row:'+i,rows:list,invoices,refs};});
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
  const comparisons=locals.map((b,j)=>{const similarity=(a.addresses?.length?a.addresses:[a.address]).map(v=>addressSimilarity(v,b.address)).sort((x,y)=>Number(y.matched)-Number(x.matched)||y.score-x.score)[0];return {b,j,code:ac.some(c=>codes(b).includes(c)),address:similarity.matched,similarity};});
  const candidates=comparisons.filter(x=>x.code||x.address);
  candidates.forEach(x=>matchedLocal.add(x.j));
  const unique=candidates.length===1?candidates[0].b:null;
  const basis=[...new Set(candidates.flatMap(x=>[x.code?'mã hóa đơn':'',x.address?'từ khóa địa chỉ ≥45%':'']).filter(Boolean))];
  const evidence=candidates.filter(x=>x.address).map(x=>'HĐ '+(x.b.invoice||x.b.ref||'nội bộ')+': '+x.similarity.percent+'% · từ trùng: '+x.similarity.common.join(', '));
  return {company:a.rows||[],local:candidates.flatMap(x=>x.b.rows||[]),source:a,companyAmount:a.amount??null,localAmount:unique?.amount??null,delta:unique&&a.amount!=null&&unique.amount!=null?a.amount-unique.amount:null,status:candidates.length?'Khớp':'Không khớp',category:candidates.length?'matched':'unmatched',basis,addressMatches:candidates.filter(x=>x.address).map(x=>({invoice:x.b.invoice||x.b.ref||'',percent:x.similarity.percent,common:x.similarity.common})),detail:(a.groupDetail?a.groupDetail+' ':'')+(candidates.length?'Khớp '+basis.join(' hoặc ')+'. '+evidence.join('; ')+(candidates.length>1?' · Có '+candidates.length+' hóa đơn nội bộ phù hợp; liệt kê tất cả, không tự bù trừ tiền.':'')+(a.error?' · Dữ liệu phụ: '+a.error:''):'Không có mã hóa đơn trùng hoặc địa chỉ đạt 45% từ khóa phù hợp. Địa chỉ khác số nhà không tự ghép. Tên, SĐT, ngày, hàng, số lượng và tiền không quyết định kết quả.')};
 });
 locals.forEach((b,j)=>{if(!matchedLocal.has(j))rows.push({company:[],local:b.rows||[],source:null,companyAmount:null,localAmount:b.amount??null,delta:null,status:'Chưa có trong Excel',category:'localOnly',basis:[],detail:'Đơn nội bộ không có mã hoặc từ khóa địa chỉ khớp trong Excel (ngưỡng 45%).'});});
 return rows;
}
// Shared payment evidence lives once in the existing synced orders payload.
function resolveReceipt(receipt,all){
 if(receipt.data||receipt.url)return receipt;
 if(!receipt.sharedReceiptId)return receipt;
 const asset=all.flatMap(o=>o.paymentReceipts||[]).find(r=>r.id===receipt.sharedReceiptId&&(r.data||r.url));
 return asset?{...asset,...receipt,data:asset.data,url:asset.url,mime:asset.mime}:receipt;
}
function preserveReceiptAssets(next,previous){
 const assets=new Map(previous.flatMap(o=>o.paymentReceipts||[]).filter(r=>r.data||r.url).map(r=>[r.id,r]));
 const present=new Set(next.flatMap(o=>o.paymentReceipts||[]).filter(r=>r.data||r.url).map(r=>r.id));
 return next.map(o=>{let changed=false;const paymentReceipts=(o.paymentReceipts||[]).map(r=>{const id=r.sharedReceiptId;if(id&&!present.has(id)&&assets.has(id)){changed=true;present.add(id);return {...assets.get(id),...r,data:assets.get(id).data,url:assets.get(id).url,mime:assets.get(id).mime};}return r;});return changed?{...o,paymentReceipts}:o;});
}
function customerMatches(o,query){
 const q=norm(query);if(!q)return true;
 const values=[o.name,o.phone,o.customerCode,o.customerId,o.clientCode];
 if(values.some(v=>norm(v).includes(q)))return true;
 const digits=String(query).replace(/\D/g,'');return digits.length>=5&&String(o.phone||'').replace(/\D/g,'').includes(digits);
}
function paymentGroup(all,ids,{id,target,markPaid=true,receipt=null,at,scope=''}){
 if(!['customer','satori'].includes(target)||!id||!at)throw Error('Nhóm thanh toán không hợp lệ.');
 const selected=new Set(ids.map(String));if(!selected.size)throw Error('Chọn ít nhất một hóa đơn.');
 for(const k of selected){const found=all.filter(o=>key(o)===k);if(found.length!==1||!active(found[0]))throw Error('Có bill đã đổi hoặc không còn hợp lệ. Mở lại nhóm trước khi lưu.');if(!markPaid&&!(target==='customer'?paid(found[0]):found[0].status==='Đã TT Satori'||found[0].satoriPaidAt))throw Error('Có bill chưa ghi thanh toán cho bên đã chọn. Bật ghi đã thanh toán hoặc bỏ chọn bill đó.');}
 let owner=true;
 return all.map(o=>{
  if(!selected.has(key(o)))return o;
  const group={id,target,at,scope},next={...o,updatedAt:Date.parse(at),paymentGroups:[...(o.paymentGroups||[]).filter(g=>g.id!==id),group]};
  if(markPaid&&target==='customer'){next.customerPaidAt=o.customerPaidAt||at;if(o.status!=='Đã TT Satori')next.status='Đã thanh toán';}
  if(markPaid&&target==='satori'){if(paid(o))next.customerPaidAt=o.customerPaidAt||at;next.satoriPaidAt=o.satoriPaidAt||at;next.status='Đã TT Satori';}
  if(receipt&&!next.paymentReceipts?.some(r=>r.id===receipt.id)){
   const meta={...receipt,groupId:id,party:target,sharedReceiptId:receipt.id};
   if(!owner){delete meta.data;delete meta.url;}owner=false;
   next.paymentReceipts=[...(o.paymentReceipts||[]),meta];
  }
  return next;
 });
}

root.SatoriAccountingCore={key,norm,number,active,statusClass,paid,resolveReceipt,preserveReceiptAssets,customerMatches,paymentGroup,items,goods,listed,total,basket,pairOrders,calculate,groupCompanyRows,addressSimilarity,identityMatch};
})(typeof window!=='undefined'?window:globalThis);



