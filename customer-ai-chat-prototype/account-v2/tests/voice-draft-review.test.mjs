import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const start=html.indexOf('/* Speech recognition is a browser input method:');
const end=html.indexOf('function updateComposerAction(){',start);
assert.ok(start>=0&&end>start,'Voice code must stay separate from the existing Gemini submit handler');
const voiceCode=html.slice(start,end);
function harness({supported=true,ready=true}={}){
 const attrs={};let dispatched=0,submitted=0,permissions=0;
 const elements={
  message:{value:'',disabled:false,readOnly:false,dispatchEvent(){dispatched++}},
  voiceStatus:{textContent:'',hidden:true},
  voiceInput:{hidden:true,disabled:true,classList:{toggle(){}},setAttribute(k,v){attrs[k]=v},title:''}
 };
 class Recognition{
  constructor(){Recognition.latest=this;this.startCount=0;this.stopCount=0;this.abortCount=0}
  start(){this.startCount++}
  stop(){this.stopCount++;this.onend?.()}
  abort(){this.abortCount++;this.onend?.()}
 }
 const context=createContext({
  window:{SpeechRecognition:supported?Recognition:undefined,addEventListener(){}},
  $:id=>elements[id],busy:false,savingCart:false,profileLoading:false,
  requireDeliverySelection:()=>{permissions++;return ready},
  updateComposerAction:()=>{},Event:class Event{constructor(type){this.type=type}}
 });
 runInContext(voiceCode,context);
 runInContext('syncVoiceButton()',context);
 return {elements,Recognition,attrs,get dispatched(){return dispatched},
  get submitted(){return submitted},get permissions(){return permissions},
  cancel:()=>runInContext('cancelVoiceInput()',context)};
}
function result(text){
 const candidate=[{transcript:text}];candidate.isFinal=true;
 return {results:[candidate]};
}
test('voice recognition is Vietnamese and only updates a reviewable draft',()=>{
 const h=harness(),{message,voiceInput,voiceStatus}=h.elements;
 assert.equal(voiceInput.hidden,false);
 message.value='Cho thêm';
 voiceInput.onclick();
 const speech=h.Recognition.latest;
 assert.equal(speech.startCount,1);
 assert.equal(speech.lang,'vi-VN');
 assert.equal(speech.continuous,false);
 assert.equal(speech.interimResults,false);
 assert.equal(message.readOnly,true);
 assert.equal(h.attrs['aria-pressed'],'true');
 speech.onresult(result('ba thùng nước suối'));
 assert.equal(message.value,'Cho thêm ba thùng nước suối');
 assert.equal(h.dispatched,1);
 assert.equal(h.submitted,0);
 assert.match(voiceStatus.textContent,/kiểm tra/i);
 speech.onend();
 assert.equal(message.readOnly,false);
 assert.equal(h.attrs['aria-pressed'],'false');
 assert.match(voiceStatus.textContent,/bấm Gửi/);
});
test('Samsung STT ủi Hồng is corrected to ổi hồng for customer review only',()=>{
 const h=harness(),{message,voiceInput,voiceStatus}=h.elements;
 voiceInput.onclick();
 const speech=h.Recognition.latest;
 speech.onresult(result('cho anh thêm hai thùng ủi Hồng'));
 assert.equal(message.value,'cho anh thêm hai thùng ổi hồng');
 assert.match(voiceStatus.textContent,/hiệu chỉnh.*ổi hồng/);
 assert.equal(h.dispatched,1);
 assert.equal(h.submitted,0);
 speech.onend();
 assert.equal(message.readOnly,false);
 assert.match(voiceStatus.textContent,/ổi hồng/);
 assert.match(voiceStatus.textContent,/bấm Gửi/);
});
test('voice correction is confined to the exact standalone product homophone',()=>{
 for(const [spoken,expected] of [
  ['ủi Hồng','ổi hồng'],
  ['Cho thêm 2 thùng ủi hồng nhé','Cho thêm 2 thùng ổi hồng nhé'],
  ['Tôi muốn ổi hồng','Tôi muốn ổi hồng'],
  ['Tôi cần ủi quần áo','Tôi cần ủi quần áo'],
  ['Bộ đồ ủi-hồng','Bộ đồ ủi-hồng'],
  ['Sản phẩm ủihồng','Sản phẩm ủihồng']
 ]){
  const h=harness();
  h.elements.voiceInput.onclick();
  h.Recognition.latest.onresult(result(spoken));
  assert.equal(h.elements.message.value,expected,spoken);
  assert.equal(h.submitted,0);
 }
});
test('existing typed draft is not rewritten by voice homophone correction',()=>{
 const h=harness();
 h.elements.message.value='Đơn ghi chú: ủi Hồng';
 h.elements.voiceInput.onclick();
 h.Recognition.latest.onresult(result('2 thùng ủi Hồng'));
 assert.equal(h.elements.message.value,'Đơn ghi chú: ủi Hồng 2 thùng ổi hồng');
 assert.equal(h.submitted,0);
});

test('tapping mic twice stops speech without sending a message',()=>{
 const h=harness();
 h.elements.voiceInput.onclick();
 const speech=h.Recognition.latest;
 h.elements.voiceInput.onclick();
 assert.equal(speech.stopCount,1);
 assert.equal(h.submitted,0);
});
test('delivery gate and disabled input prevent opening microphone',()=>{
 const h=harness({ready:false});
 h.elements.voiceInput.onclick();
 assert.equal(h.Recognition.latest,undefined);
 assert.equal(h.permissions,1);
 const second=harness();
 second.elements.message.disabled=true;
 second.elements.voiceInput.onclick();
 assert.equal(second.Recognition.latest,undefined);
});
test('unsupported speech API remains hidden and does not throw',()=>{
 const h=harness({supported:false});
 assert.equal(h.elements.voiceInput.hidden,true);
 assert.equal(h.elements.voiceInput.disabled,true);
 h.elements.voiceInput.onclick();
});
test('microphone permission errors show explanation and preserve typed draft',()=>{
 const h=harness();
 h.elements.message.value='Nội dung đã gõ';
 h.elements.voiceInput.onclick();
 const speech=h.Recognition.latest;
 speech.onerror({error:'not-allowed'});
 speech.onend();
 assert.equal(h.elements.message.value,'Nội dung đã gõ');
 assert.match(h.elements.voiceStatus.textContent,/quyền micro/i);
});
test('canceled recognition ignores late transcripts',()=>{
 const h=harness();
 h.elements.voiceInput.onclick();
 const speech=h.Recognition.latest;
 h.cancel();
 speech.onresult(result('phải bỏ qua'));
 assert.equal(speech.abortCount,1);
 assert.equal(h.elements.message.value,'');
 assert.equal(h.elements.message.readOnly,false);
});
test('original Gemini send logic remains explicitly manual and blocks listening',()=>{
 assert.match(html,/\$\('send'\)\.onclick=async\(\)=>\{/);
 assert.match(html,/if\(!message\|\|busy\|\|voiceListening\)return;/);
 assert.match(html,/button\.disabled=voiceListening\|\|busy/);
 assert.doesNotMatch(voiceCode,/\$\('send'\)\.click\(|\/api\/v2\/interpret|\/api\/v2\/checkout/);
 assert.match(html,/window\.addEventListener\('pagehide',cancelVoiceInput\)/);
 assert.match(html,/if\(name!=='chat'\)\{cancelVoiceInput\(\);/);
});
