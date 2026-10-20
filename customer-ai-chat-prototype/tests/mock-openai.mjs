// TEST DOUBLE ONLY. It intercepts OpenAI calls during local automated tests.
// Never used by the real server process or production. No other model is involved.
const original=globalThis.fetch;
globalThis.fetch=async (url,opts)=>{
 if(String(url)!=='https://api.openai.com/v1/responses')return original(url,opts);
 const input=JSON.parse(opts.body).input?.[0]?.content||'';
 if(input==='__test_network__')throw Object.assign(new Error('SECRET_SENTINEL_DO_NOT_EXPOSE'),{cause:{code:'ENOTFOUND'}});
 if(input==='__test_unknown__')throw new Error('SECRET_SENTINEL_DO_NOT_EXPOSE');
 if(input==='__test_quota__')return {ok:false,status:429,json:async()=>({error:{code:'insufficient_quota',message:'SECRET_SENTINEL_DO_NOT_EXPOSE'}})};
 const norm=input.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase();
 const change=/giao den|dia chi khac|doi dia chi|sdt moi|so dien thoai moi/.test(norm);
 const sku=norm.includes('5l')?'S5L':norm.includes('500ml')?'S500':norm.includes('350ml')?'S350':'unknown';
 const qty=Number(norm.match(/(\d+)\s*thung/)?.[1]||0);
 const parsed={intent:'order',sku,qty,use_last_order:norm.includes('lan truoc'),receiver_or_phone_change:false,address_change:change,clarification:''};
 return {ok:true,status:200,json:async()=>({output:[{content:[{type:'output_text',text:JSON.stringify(parsed)}]}]})};
};
