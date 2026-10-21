const str={type:'string'},num={type:'number',minimum:0},int={type:'integer'},id={type:['string','number']};
const obj=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const filter={query:{type:'string',maxLength:150},from:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},to:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'}};
const actions=[
 ['satori_trash_list','trash.list','Tìm hóa đơn còn trong thùng rác 30 ngày theo số hóa đơn, tên, số điện thoại hoặc địa chỉ. Chỉ đọc; dùng để xác định đúng hóa đơn trước khi khôi phục.',obj({query:filter.query,limit:int}),false],
 ['satori_restore_order','orders.restore','Khôi phục đúng hóa đơn còn trong thùng rác 30 ngày khi người dùng yêu cầu rõ. Đọc trash.list và revision mới nhất; xác minh ID, số hóa đơn, tên khách, tổng tiền. Giữ nguyên trạng thái thanh toán, không tự đánh dấu đã trả. Giữ requestId khi thử lại.',obj({expectedRevision:int,requestId:str,id,invoiceNo:int,expectedName:str,expectedTotal:num,confirmed:{type:'boolean',const:true}},['expectedRevision','requestId','id','invoiceNo','expectedName','expectedTotal','confirmed']),true],
 ['satori_system_status','system.status','Đọc revision và tổng số bill hiện tại.',obj({}),false],
 ['satori_customers_search','customers.search','Tìm tên/địa chỉ qua query, hoặc SĐT qua phone. Nếu requiresSelection, hỏi đúng điểm giao trước khi tạo đơn.',obj({query:filter.query,phone:str,limit:int}),false],
 ['satori_orders_list','orders.list','Tra bill theo khách, SĐT, mã khách, số bill và khoảng ngày; không ghi dữ liệu.',obj({...filter,status:str,limit:int}),false],
 ['satori_update_order_quantity','orders.updateQty','Chỉnh số lượng một dòng hàng trên hóa đơn thật chỉ khi người dùng yêu cầu rõ. Đọc bill và revision mới nhất trước khi ghi; đối chiếu ID, số hóa đơn, tên khách, tổng cũ và itemId; giữ nguyên địa chỉ, giá, chiết khấu và trạng thái thanh toán. Không sửa khi người dùng đã đổi ý.',obj({expectedRevision:int,requestId:str,id,invoiceNo:int,expectedName:str,expectedTotal:num,itemId:id,qty:{type:'integer',minimum:1,maximum:100000},confirmed:{type:'boolean',const:true}},['expectedRevision','requestId','id','invoiceNo','expectedName','expectedTotal','itemId','qty','confirmed']),true],
 ['satori_invoice_pdf_source','orders.pdfSource','Đọc dữ liệu gốc cần thiết để xuất PDF đúng mẫu Minh Satori; chỉ đọc, chưa phải tệp PDF. Chọn chính xác ID + số hóa đơn. Không trình bày dữ liệu trả về như file PDF đã xuất.',obj({id,invoiceNo:int},['id','invoiceNo']),false],
 ['satori_debt_summary','debt.summary','Tra công nợ trong khoảng ngày. Chỉ trả đủ/chưa trả; Đã TT Satori không đồng nghĩa khách đã trả.',obj(filter),false],
 ['satori_orders_create','orders.create','Tạo đơn khi người dùng yêu cầu rõ. Lấy revision mới nhất, chọn customerRef đúng chi nhánh, giữ requestId khi thử lại.',obj({expectedRevision:int,requestId:str,customerRef:obj({id,invoiceNo:int},['id','invoiceNo']),confirmedNewCustomer:{type:'boolean'},order:obj({name:str,phone:str,location:str,deliveryDate:filter.from,items:{type:'array',minItems:1,maxItems:50,items:obj({product:str,code:str,unit:str,qty:{type:'integer',minimum:1},unitPrice:num,listPrice:num},['product','qty','unitPrice'])},shippingAmount:num,vatAmount:num,total:num},['name','items'])},['expectedRevision','requestId','order']),true],
 ['satori_mark_customer_paid','payments.markCustomerPaid','Ghi đã nhận đủ tiền khi người dùng xác nhận cho bill cụ thể. Không chuyển tiền. Đọc revision và tổng bill trước.',obj({expectedRevision:int,invoiceNo:int,confirmed:{type:'boolean',const:true},amount:num},['expectedRevision','invoiceNo','confirmed','amount']),true],
 ['satori_soft_delete_order','orders.delete','Xóa mềm đúng bill người dùng yêu cầu vào thùng rác 30 ngày. Cần ID/bill/tên/tổng, revision và xác nhận. Không xóa bill thật để thử.',obj({expectedRevision:int,requestId:str,id,invoiceNo:int,expectedName:str,expectedTotal:num,confirmed:{type:'boolean',const:true}},['expectedRevision','requestId','id','invoiceNo','expectedName','expectedTotal','confirmed']),true]
];
export const instructions='Dùng API ký HMAC của Minh Satori, không sửa GitHub để thao tác bill. Luôn đọc revision và đúng khách/địa chỉ trước khi ghi. Nhiều điểm giao phải hỏi lại. Thanh toán chỉ ghi khi người dùng xác nhận nhận đủ. Xóa chỉ mềm và cần yêu cầu rõ ràng. Khôi phục: đọc trash.list, chọn đúng hóa đơn còn hạn 30 ngày rồi gọi orders.restore; không tạo lại đơn để thay thế. Nếu trùng số hóa đơn hoặc đã hết hạn phải báo rõ, không ghi đè. Không tự thay đổi thanh toán khi khôi phục. Không thử ghi trên production. Lỗi mạng: tra lại kết quả, giữ requestId khi thử lại. REVISION_CONFLICT: đọc lại trước thao tác. Không tiết lộ secret. Chưa cấu hình API thì báo chưa kết nối, không suy đoán dữ liệu.';
export const configuration=(env={})=>({configured:!!(env.SATORI_BOT_API_URL&&env.SATORI_BOT_KEY_ID&&env.SATORI_BOT_SECRET),writesEnabled:env.SATORI_ENABLE_WRITES==='true'});
export function tools(env={}){return actions.filter(a=>!a[4]||configuration(env).writesEnabled).map(([name,,description,inputSchema,write])=>({name,description,inputSchema,annotations:{readOnlyHint:!write,destructiveHint:write,idempotentHint:false,openWorldHint:false}}));}
function validate(v,s,path='payload'){
 if(s.type==='object'){if(!v||typeof v!=='object'||Array.isArray(v))throw Error(path+' phải là object');for(const k of s.required||[])if(v[k]===undefined)throw Error('Thiếu '+path+'.'+k);for(const k of Object.keys(v)){if(!Object.hasOwn(s.properties,k))throw Error('Trường không hỗ trợ: '+k);validate(v[k],s.properties[k],path+'.'+k);}return;}
 if(!(Array.isArray(s.type)?s.type:[s.type]).some(t=>t==='integer'?Number.isSafeInteger(v):t==='array'?Array.isArray(v):typeof v===t))throw Error(path+' sai kiểu');
 if(s.const!==undefined&&v!==s.const)throw Error(path+' cần xác nhận rõ');
 if(typeof v==='number'&&(!Number.isFinite(v)||s.minimum!==undefined&&v<s.minimum||s.maximum!==undefined&&v>s.maximum))throw Error(path+' sai giá trị');
 if(typeof v==='string'&&((s.maxLength&&v.length>s.maxLength)||(s.pattern&&!new RegExp(s.pattern).test(v))))throw Error(path+' sai định dạng');
 if(Array.isArray(v)){if(v.length<(s.minItems||0)||v.length>(s.maxItems||Infinity))throw Error(path+' sai số mục');for(const item of v)validate(item,s.items,path+'[]');}
}
export async function callTool(name,payload,env,fetcher=fetch){
 const a=actions.find(a=>a[0]===name);if(!a)throw Error('Lệnh không hỗ trợ');if(a[4]&&!configuration(env).writesEnabled)throw Error('Quyền ghi chưa được bật.');
 validate(payload,a[3]);if(payload.from&&payload.to&&payload.from>payload.to)throw Error('Khoảng ngày không hợp lệ');
 if(!configuration(env).configured)throw Error('Chưa kết nối API Apps Script. Chưa có dữ liệu trực tuyến.');
 const url=new URL(env.SATORI_BOT_API_URL);if(url.protocol!=='https:'||url.hostname!=='script.google.com'||!/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)||url.search||url.username||url.password)throw Error('Endpoint Apps Script không hợp lệ');
 if(!/^[a-zA-Z0-9_-]{3,64}$/.test(env.SATORI_BOT_KEY_ID)||env.SATORI_BOT_SECRET.length<32)throw Error('Cấu hình xác thực chưa hợp lệ');
 const b={keyId:env.SATORI_BOT_KEY_ID,timestamp:Date.now(),nonce:crypto.randomUUID(),action:a[1],payload};const e=new TextEncoder(),key=await crypto.subtle.importKey('raw',e.encode(env.SATORI_BOT_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 b.signature=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,e.encode([b.keyId,b.timestamp,b.nonce,b.action,JSON.stringify(payload)].join('\n')))),n=>n.toString(16).padStart(2,'0')).join('');
 // Keep the wire representation ASCII so Apps Script request decoding cannot
 // change Vietnamese text before it verifies the UTF-8 HMAC message.
 const body=JSON.stringify(b).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
 let response;try{response=await fetcher(url.toString(),{method:'POST',headers:{'content-type':'application/json; charset=utf-8'},body,redirect:'follow',signal:AbortSignal.timeout(35000)});}catch{throw Error('Chưa xác minh kết quả do kết nối API. Với lệnh ghi, tra lại trước khi thử lại.');}
 if(!response.ok)throw Error('Kết nối Apps Script HTTP '+response.status);let result;try{result=await response.json();}catch{throw Error('Apps Script chưa trả JSON. Kiểm tra deployment và quyền truy cập.');}
 if(result.ok!==true)throw Error((result.error?.code||'API_ERROR')+': '+(result.error?.message||'API từ chối yêu cầu'));
 console.info(JSON.stringify({action:a[1],ok:true,revision:result.revision}));return result;
}
