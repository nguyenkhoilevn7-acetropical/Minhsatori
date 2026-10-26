import test from 'node:test';import assert from 'node:assert/strict';import {validGoogleClaims} from '../google-claims.mjs';
test('verified-token claims enforce Google issuer, exact audience, immutable sub and time bounds',()=>{
 const now=Date.now(),p={aud:'web-client',iss:'https://accounts.google.com',sub:'12345',email_verified:true,iat:Math.floor(now/1000)-30,exp:Math.floor(now/1000)+300};
 assert.equal(validGoogleClaims(p,'web-client',now),true);
 for(const patch of [{aud:'android-unapproved-client'},{iss:'https://invalid.example'},{sub:''},{email_verified:false},{iat:p.exp+1},{exp:p.iat}])
  assert.equal(validGoogleClaims({...p,...patch},'web-client',now),false);
 assert.equal(validGoogleClaims(p,'',now),false);
});
