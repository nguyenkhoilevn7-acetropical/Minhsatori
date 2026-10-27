'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '../api/InvoicePdfArchive.gs'), 'utf8');
const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(180, 65)]);
const hash = (b) => crypto.createHash('sha256').update(Buffer.from(b)).digest('hex');
const order = () => ({
  id: String(Date.now()), invoiceNo: 990001, date: '2026-10-27',
  name: 'FAKE ONLY', phone: '000', location: 'FAKE ADDRESS',
  items: [{ product: 'FAKE WATER', qty: 5, unitPrice: 98000 }],
  vat: 0, vatAmount: 0, shippingAmount: 0, total: 392000
});
const driveFile = (bytes, id = 'fake-drive-file') => ({
  getId: () => id,
  getSize: () => bytes.length,
  getBlob: () => ({ getBytes: () => Array.from(bytes) }),
  setDescription: () => {}
});
function setup(invoice, existingFiles = [], savedBytes = pdf) {
  const folder = {
    getFilesByName() {
      const left = [...existingFiles];
      return { hasNext: () => left.length > 0, next: () => left.shift() };
    },
    createFile() { return driveFile(savedBytes, 'fake-created-file'); }
  };
  const Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    computeDigest: (_, b) => Array.from(crypto.createHash('sha256').update(Buffer.from(b)).digest()),
    newBlob: (v) => ({ getBytes: () => Array.from(Buffer.from(v)) }),
    base64Decode: (s) => Array.from(Buffer.from(s, 'base64'))
  };
  const context = {
    Utilities, DriveApp: { getFolderById: () => folder },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'FAKE_FOLDER' }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    requireOwner_() {},
    readState_: () => ({ revision: 9, values: { satori_orders_v15: JSON.stringify([invoice]) } })
  };
  vm.runInNewContext(source, context, { filename: 'InvoicePdfArchive.gs' });
  return context.SatoriInvoicePdfArchive;
}
const key = (invoice) => setup(invoice).pending({
  values: { satori_orders_v15: JSON.stringify([invoice]) }, revision: 9
}, { limit: 1 }).jobs[0].versionKey;
const payload = (invoice, versionKey) => ({
  id: invoice.id, invoiceNo: invoice.invoiceNo, total: invoice.total,
  versionKey, pdfSha256: hash(pdf), pdfBase64: pdf.toString('base64')
});

test('total-only edit invalidates PDF version key', () => {
  const a = order(), b = { ...a, total: a.total + 31360 };
  assert.notEqual(key(a), key(b));
});
test('VAT edit invalidates PDF version key', () => {
  const a = order(), b = { ...a, vat: 8, vatAmount: 31360, total: 423360 };
  assert.notEqual(key(a), key(b));
});
test('stale PDF is rejected after a total-only edit', () => {
  const a = order(), b = { ...a, total: a.total + 31360 };
  assert.throws(() => setup(b).archive(payload(a, key(a))), /thay đổi/);
});
test('same-name Drive file with different bytes fails closed', () => {
  const a = order(), wrong = Buffer.from(pdf);
  wrong[wrong.length - 1] ^= 1;
  assert.throws(() => setup(a, [driveFile(wrong)]).archive(payload(a, key(a))), /SHA-256/);
});
test('same-name Drive file with identical bytes is an idempotent duplicate', () => {
  const a = order();
  const result = setup(a, [driveFile(pdf)]).archive(payload(a, key(a)));
  assert.equal(result.duplicate, true);
  assert.equal(result.fileId, 'fake-drive-file');
});
test('ambiguous same-name PDF files fail closed', () => {
  const a = order();
  assert.throws(() => setup(a, [driveFile(pdf), driveFile(pdf)]).archive(payload(a, key(a))), /trung ten/);
});
test('Drive content mismatch after create fails verification', () => {
  const a = order(), corrupt = Buffer.from(pdf);
  corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => setup(a, [], corrupt).archive(payload(a, key(a))), /SHA-256/);
});
