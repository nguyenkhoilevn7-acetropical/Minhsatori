import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareOrderIntake, submitPreparedOrder} from '../order-intake.mjs';
import {tools as connectorTools} from '../lib/satori.mjs';

const catalogue = [
  {code:'WATER-1500',name:'Nước suối 1.5L',unit:'Thùng',unitPrice:70000,listPrice:90000}
];
const profile = {
  id:101,invoiceNo:9100,name:'Ốc Q',phone:'0900000001',
  address:'101 Đường Thử A',defaultVatRate:8
};
const base = {
  source:'text', transcript:'Lên đơn 2 thùng nước suối 1.5L cho Ốc Q',
  extracted:{
    customer:{name:'Ốc Q',phone:'0900000001',address:'101 Đường Thử A'},
    items:[{product:'Nước suối 1.5L',qty:2}],
    shippingAmount:0
  },
  customerProfile:profile,catalogue,expectedRevision:244,requestId:'fake-order-0001'
};


test('canonical satori_orders_create connector schema accepts per-line tax fields', () => {
  const create=connectorTools({SATORI_ENABLE_WRITES:'true'}).find(x=>x.name==='satori_orders_create');
  assert.ok(create);
  const itemSchema=create.inputSchema.properties.order.properties.items.items;
  assert.ok(itemSchema.properties.vatRate);
  assert.ok(itemSchema.properties.vatAmount);
});

test('text and voice transcript share the same deterministic intake path', () => {
  const textDraft=prepareOrderIntake(base);
  const voiceDraft=prepareOrderIntake({...base,source:'voice_transcript'});
  assert.equal(textDraft.status,'READY_FOR_OWNER_CONFIRMATION');
  assert.equal(voiceDraft.status,'READY_FOR_OWNER_CONFIRMATION');
  assert.deepEqual(voiceDraft.toolCall,textDraft.toolCall);
  assert.equal(textDraft.toolCall.name,'satori_orders_create');
});

test('missing recipient, product or quantity is returned for clarification; no guessing', () => {
  const missing=prepareOrderIntake({...base,customerProfile:null,extracted:{
    customer:{name:'Ốc Q'},items:[{product:'Nước suối 1.5L'}]
  }});
  assert.equal(missing.status,'NEEDS_CONFIRMATION');
  const codes=missing.issues.map(x=>x.code);
  assert.ok(codes.includes('ADDRESS_REQUIRED'));
  assert.ok(codes.includes('QUANTITY_REQUIRED'));
  assert.ok(codes.includes('CUSTOMER_SELECTION_REQUIRED'));
  assert.equal(missing.toolCall,undefined);
});

test('manual-entry line defaults to no tax and is not overwritten by the customer profile', () => {
  const prepared=prepareOrderIntake({...base,extracted:{
    customer:base.extracted.customer,
    items:[{manualEntry:true,product:'Tiền cọc',qty:1,unit:'Khoản',unitPrice:500000}],
    shippingAmount:0
  }});
  assert.equal(prepared.status,'READY_FOR_OWNER_CONFIRMATION');
  const line=prepared.toolCall.payload.order.items[0];
  assert.equal(line.vatRate,0);
  assert.equal(line.vatAmount,0);
  assert.equal(prepared.toolCall.payload.order.vatAmount,0);
  assert.equal(prepared.toolCall.payload.order.total,500000);
});

test('catalogue lines follow a no-tax customer profile instead of inventing 8 percent', () => {
  const prepared=prepareOrderIntake({...base,customerProfile:{...profile,defaultVatRate:0}});
  assert.equal(prepared.status,'READY_FOR_OWNER_CONFIRMATION');
  const line=prepared.toolCall.payload.order.items[0];
  assert.equal(line.vatRate,0);
  assert.equal(line.vatAmount,0);
  assert.equal(prepared.toolCall.payload.order.vatAmount,0);
  assert.equal(prepared.toolCall.payload.order.total,140000);
});

test('explicit per-line tax rate overrides customer profile default', () => {
  const prepared=prepareOrderIntake({...base,extracted:{
    customer:base.extracted.customer,
    items:[
      {product:'Nước suối 1.5L',qty:2},
      {manualEntry:true,product:'Tiền cọc',qty:1,unit:'Khoản',unitPrice:500000,taxChoiceExplicit:true,vatRate:0},
      {manualEntry:true,product:'Dịch vụ khác',qty:1,unit:'Khoản',unitPrice:100000,taxChoiceExplicit:true,vatRate:5.5}
    ]
  }});
  assert.equal(prepared.status,'READY_FOR_OWNER_CONFIRMATION');
  const lines=prepared.toolCall.payload.order.items;
  assert.deepEqual(lines.map(x=>x.vatRate),[8,0,5.5]);
  assert.deepEqual(lines.map(x=>x.vatAmount),[11200,0,5500]);
  assert.equal(prepared.toolCall.payload.order.vatAmount,16700);
});


test('selected customer profile supplies its exact saved phone when transcript omits it', () => {
  const prepared=prepareOrderIntake({...base,extracted:{
    customer:{name:'Ốc Q',address:'101 Đường Thử A'},
    items:[{product:'Nước suối 1.5L',qty:1}]
  }});
  assert.equal(prepared.status,'READY_FOR_OWNER_CONFIRMATION');
  assert.equal(prepared.toolCall.payload.order.phone,'0900000001');
});

test('missing customer tax profile blocks new lines instead of guessing a tax rate', () => {
  const prepared=prepareOrderIntake({...base,customerProfile:{...profile,defaultVatRate:undefined}});
  assert.equal(prepared.status,'NEEDS_CONFIRMATION');
  assert.ok(prepared.issues.some(x=>x.code==='TAX_PROFILE_REQUIRED'));
});

test('ambiguous or missing catalogue product is not guessed', () => {
  const prepared=prepareOrderIntake({...base,catalogue:[
    ...catalogue,{code:'WATER-ALT',name:'Nước suối 1.5L',unit:'Thùng',unitPrice:71000,listPrice:90000}
  ]});
  assert.equal(prepared.status,'NEEDS_CONFIRMATION');
  assert.ok(prepared.issues.some(x=>x.code==='PRODUCT_AMBIGUOUS'));
});


test('missing product name is blocked rather than inferred from the transcript', () => {
  const prepared=prepareOrderIntake({...base,extracted:{
    customer:base.extracted.customer,
    items:[{qty:2}]
  }});
  assert.equal(prepared.status,'NEEDS_CONFIRMATION');
  assert.ok(prepared.issues.some(x=>x.code==='PRODUCT_NOT_FOUND'));
  assert.equal(prepared.toolCall,undefined);
});

test('customer profile mismatch is not silently converted into a new customer', () => {
  const prepared=prepareOrderIntake({...base,customerProfile:{...profile,address:'Địa chỉ khác'}});
  assert.equal(prepared.status,'NEEDS_CONFIRMATION');
  assert.ok(prepared.issues.some(x=>x.code==='CUSTOMER_PROFILE_MISMATCH'));
});

test('request id and revision are mandatory before an orders.create payload exists', () => {
  const prepared=prepareOrderIntake({...base,requestId:'bad',expectedRevision:null});
  assert.equal(prepared.status,'NEEDS_CONFIRMATION');
  assert.equal(prepared.toolCall,undefined);
});

test('owner confirmation is required and duplicate retries retain the same requestId', async () => {
  const prepared=prepareOrderIntake(base);
  let calls=0;
  const seen=new Set();
  const executor=async(name,payload)=>{
    calls++;
    const duplicate=seen.has(payload.requestId);
    seen.add(payload.requestId);
    return {name,requestId:payload.requestId,duplicate};
  };
  await assert.rejects(submitPreparedOrder({prepared,executeCanonicalTool:executor,ownerApproved:false}),/confirmation/);
  assert.equal(calls,0);
  const first=await submitPreparedOrder({prepared,executeCanonicalTool:executor,ownerApproved:true});
  const retry=await submitPreparedOrder({prepared,executeCanonicalTool:executor,ownerApproved:true});
  assert.equal(first.requestId,'fake-order-0001');
  assert.equal(first.duplicate,false);
  assert.equal(retry.duplicate,true);
  assert.equal(retry.requestId,first.requestId);
  assert.equal(calls,2);
});
