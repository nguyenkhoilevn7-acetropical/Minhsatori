/**
 * Non-sensitive startup diagnosis of the independent signed READ gateway.
 * Do not log environment values, their lengths, prefixes or hashes.
 */
export function describeCanonicalReadEnv(env={}){
 const endpoint=String(env.SATORI_READ_ENDPOINT||'').trim();
 const keyId=String(env.SATORI_READ_KEY_ID||'');
 const secret=String(env.SATORI_READ_HMAC_SECRET||'');
 return Object.freeze({
  readEndpointValid:/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(endpoint),
  readKeyIdValid:/^[A-Za-z0-9_-]{3,64}$/.test(keyId),
  readHmacSecretValid:secret.length>=32
 });
}
