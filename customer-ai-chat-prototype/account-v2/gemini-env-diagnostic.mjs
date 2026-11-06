/**
 * Read-only diagnostics for Render runtime. NEVER log a secret's value,
 * length, prefix, hash, or any customer identifier.
 * Gemini readiness in free-parser.mjs deliberately requires strict 'true'.
 */
export function describeGeminiRuntime(env) {
 const keyPresent=typeof env.GEMINI_API_KEY==='string'&&env.GEMINI_API_KEY.trim().length>0;
 const raw=env.GEMINI_FREE_TIER_ONLY;
 const flagPresent=typeof raw==='string';
 return Object.freeze({
  apiKeyPresent:Boolean(keyPresent),
  freeTierFlagPresent:flagPresent,
  freeTierFlagExactTrue:raw==='true',
  freeTierFlagNormalizedTrue:flagPresent&&raw.trim().toLowerCase()==='true',
  googleApiKeyOnly:!keyPresent&&typeof env.GOOGLE_API_KEY==='string'&&
   env.GOOGLE_API_KEY.trim().length>0
 });
}
