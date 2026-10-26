// Additional claim validation AFTER google-auth-library verifies the signature.
export function validGoogleClaims(p,audience,now=Date.now()){
 return !!(audience&&p&&p.aud===audience&&
  ['accounts.google.com','https://accounts.google.com'].includes(p.iss)&&
  typeof p.sub==='string'&&/^[A-Za-z0-9_-]{1,255}$/.test(p.sub)&&p.email_verified===true&&
  Number.isSafeInteger(p.exp)&&p.exp*1000>now&&
  Number.isSafeInteger(p.iat)&&p.iat*1000<=now+60000&&p.iat<p.exp);
}
