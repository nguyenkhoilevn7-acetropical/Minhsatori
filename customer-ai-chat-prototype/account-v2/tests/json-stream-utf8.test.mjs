import test from 'node:test';
import assert from 'node:assert/strict';
import {json} from '../router.mjs';

function requestFromChunks(chunks){
 return {[Symbol.asyncIterator]:async function*(){
  for(const chunk of chunks)yield chunk;
 }};
}

test('Vietnamese registration contact survives an arbitrary UTF-8 chunk split',async()=>{
 const original={fullName:'Hà Minh Nguyệt',recipientName:'Đào Khuê Nguyên',
  address:'752 Sư Vạn Hạnh, Phường 12, Quận 10',note:'Giao trước 2 giờ chiều'};
 const bytes=Buffer.from(JSON.stringify(original),'utf8');
 // A multibyte character can be cut between HTTP request chunks.
 const split=bytes.findIndex((byte,index)=>index>0&&byte>=0xc2&&byte<=0xf4);
 assert.ok(split>0);
 assert.deepEqual(await json(requestFromChunks([
  bytes.subarray(0,split+1),bytes.subarray(split+1)
 ])),original);
});

test('Vietnamese request body survives one-byte-at-a-time streaming',async()=>{
 const original={message:'Đặt 10 thùng nước gửi Hà Minh Nguyệt'};
 const bytes=Buffer.from(JSON.stringify(original),'utf8');
 assert.deepEqual(await json(requestFromChunks(
  [...bytes].map(byte=>Buffer.from([byte]))
 )),original);
});

test('invalid UTF-8, non-object JSON and oversized payloads fail closed',async()=>{
 await assert.rejects(
  json(requestFromChunks([Buffer.from([0x7b,0x22,0x61,0x22,0x3a,0x22,0xc3,0x22,0x7d])])),
  e=>e.code==='INVALID_JSON'&&e.status===400);
 await assert.rejects(json(requestFromChunks([Buffer.from('[1,2]')])),
  e=>e.code==='JSON_OBJECT_REQUIRED'&&e.status===400);
 await assert.rejects(json(requestFromChunks([Buffer.alloc(24_001,0x20)])),
  e=>e.code==='REQUEST_TOO_LARGE'&&e.status===413);
});
