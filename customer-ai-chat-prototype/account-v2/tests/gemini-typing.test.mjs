import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
function isolatedTyping(nowValue){
 let scheduled=[];
 const reply={
  classList:{removed:[],remove(name){this.removed.push(name)}},
  removed:[],removeAttribute(attr){this.removed.push(attr)},textContent:''
 };
 const context=vm.createContext({
  Date:{now:()=>nowValue},
  setTimeout:(callback,ms)=>{scheduled.push(ms);callback()}
 });
 const start=inline.indexOf('const GEMINI_TYPING_MIN_MS=1500;');
 const end=inline.indexOf('\nfunction count()',start);
 assert.ok(start>=0&&end>start,'typing implementation must exist');
 vm.runInContext(inline.slice(start,end),context,{timeout:500});
 return {reply,context,scheduled};
}
test('compact three-dot indicator uses subtle gray, respects reduced motion',()=>{
 assert.match(html,/\.bubble\.ai\.typing\{/);
 assert.match(html,/\.typing-dots i\{[^}]*background:#8e8e93/);
 assert.match(html,/gemini-typing-dot 1\.15s/);
 assert.match(html,/@media\(prefers-reduced-motion:reduce\)\{\.typing-dots i\{animation:none/);
 assert.match(inline,/const dots=node\('span',undefined,'typing-dots'\)/);
 assert.match(inline,/for\(let i=0;i<3;i\+\+\)dots\.append\(node\('i'\)\)/);
 assert.doesNotMatch(inline,/textContent='Đang phân tích yêu cầu\.\.\.'/);
});
test('response ready immediately still displays typing for at least 1500 milliseconds',async()=>{
 const t=isolatedTyping(10_000);
 await t.context.revealGeminiReply(t.reply,'Đã nhận',10_000);
 assert.deepEqual(t.scheduled,[1500]);
 assert.equal(t.reply.textContent,'Đã nhận');
 assert.ok(t.reply.classList.removed.includes('typing'));
 assert.deepEqual(t.reply.removed,['role','aria-label']);
});
test('slower backend only waits remaining time; never delays an already slow answer',async()=>{
 const medium=isolatedTyping(10_800);
 await medium.context.revealGeminiReply(medium.reply,'OK',10_000);
 assert.deepEqual(medium.scheduled,[700]);
 const slow=isolatedTyping(13_000);
 await slow.context.revealGeminiReply(slow.reply,'OK',10_000);
 assert.deepEqual(slow.scheduled,[]);
});
test('success and error both replace typing without prematurely releasing send button',()=>{
 assert.match(inline,/const reply=geminiTypingBubble\(\),typingStartedAt=Date\.now\(\)/);
 assert.match(inline,/await revealGeminiReply\(reply,result\.message\|\|/);
 assert.match(inline,/await revealGeminiReply\(reply,'Chưa xử lý được/);
 assert.match(inline,/\}finally\{\s*busy=false;\$\('send'\)\.disabled=false/);
 assert.doesNotThrow(()=>new vm.Script(inline));
});
