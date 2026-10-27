/** Offline review only. Caller must authorize tenantId before supplying snapshots.
 * No DB/network IO, automatic merges, account linking or policy mutation. */
const text = value => typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/gu, ' ') : '';
const phone = value => {
 const raw = text(value);
 if (!/^[+\d\s().-]+$/.test(raw)) return '';
 const digits = raw.replace(/[^\d]/g, '').replace(/^84(?=[35789]\d{8}$)/, '0');
 return /^0[35789]\d{8}$/.test(digits) ? digits : '';
};
const sub = row => row.googleVerified === true ? text(row.googleSub) : '';
const addresses = row => [...new Set((row.addresses || []).map(text).filter(Boolean))].sort();
function validate(rows, tenantId) {
 if (!Array.isArray(rows)) throw Error('INVALID_REVIEW_SNAPSHOT');
 // Filter before validating or comparing other tenants: no cross-tenant identifiers in output.
 const scoped = rows.filter(r => r && r.tenantId === tenantId);
 const ids = new Set();
 for (const r of scoped) {
  if (!text(r.id) || ids.has(r.id) || !Number.isSafeInteger(r.revision) || r.revision < 1 ||
      !['customer','agency','collaborator'].includes(r.kind) ||
      !Array.isArray(r.addresses) || r.addresses.some(a => typeof a !== 'string') ||
      !Number.isInteger(r.discountBps) || r.discountBps < 0 || r.discountBps > 10000) {
   throw Error('INVALID_REVIEW_SNAPSHOT');
  }
  ids.add(r.id);
 }
 return scoped;
}
export function reviewCustomers({tenantId, source, target}) {
 if (!text(tenantId)) throw Error('TENANT_REQUIRED');
 const incoming = validate(source, tenantId), existing = validate(target, tenantId);
 return incoming.map(row => {
  const candidates = existing.filter(other =>
   (sub(row) && sub(row) === sub(other)) || (phone(row.phone) && phone(row.phone) === phone(other.phone)));
  const sourceCollision = incoming.some(other => other.id !== row.id &&
   ((sub(row) && sub(row) === sub(other)) || (phone(row.phone) && phone(row.phone) === phone(other.phone))));
  return {
   sourceId:row.id, sourceRevision:row.revision,
   decision: candidates.length || sourceCollision ? 'MANUAL_REVIEW' : 'UNMATCHED_REVIEW',
   sourceCollision, writesAllowed:false,
   candidates:candidates.map(other => {
    const reasons = [];
    if (sub(row) && sub(row) === sub(other)) reasons.push('VERIFIED_GOOGLE_SUB_EQUAL');
    if (phone(row.phone) && phone(row.phone) === phone(other.phone)) reasons.push('PHONE_EQUAL_NOT_IDENTITY_PROOF');
    if (sub(row) && sub(other) && sub(row) !== sub(other)) reasons.push('GOOGLE_IDENTITY_CONFLICT');
    if (text(row.name) !== text(other.name)) reasons.push('NAME_DIFFERENT');
    if (row.kind !== other.kind) reasons.push('ROLE_DIFFERENT');
    if (row.discountBps !== other.discountBps) reasons.push('DISCOUNT_REQUIRES_ADMIN_REVIEW');
    if (JSON.stringify(addresses(row)) !== JSON.stringify(addresses(other))) reasons.push('ADDRESS_SET_DIFFERENT');
    return {targetId:other.id,targetRevision:other.revision,reasons};
   })
  };
 });
}
