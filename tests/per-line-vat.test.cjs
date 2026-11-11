const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('function currentDefaultVatRate()');
const end = html.indexOf('function hasInvalidLineVat()', start);
assert.ok(start >= 0 && end > start, 'actual website VAT helper functions must exist');
const source = html.slice(start, end);
const sandbox = {
  document: { getElementById: () => ({ value: 'yes' }) },
  getOrderGoodsTotal: order => (order.items || []).reduce(
    (sum, item) => sum + Number(item.qty || 0) * Number(item.unitPrice || 0), 0)
};
vm.createContext(sandbox);
vm.runInContext(source + '\nthis.testApi={currentDefaultVatRate,lineVatAmount,invoiceVatAmount,invoiceLineVatRate,invoiceLineVatAmount};', sandbox);
const { currentDefaultVatRate, lineVatAmount, invoiceVatAmount, invoiceLineVatRate, invoiceLineVatAmount } = sandbox.testApi;

test('website defaults a new row to the active profile default (8%)', () => {
  assert.equal(currentDefaultVatRate(), 8);
  assert.equal(lineVatAmount({qty:2,unitPrice:10000}), 1600);
});

test('website supports zero VAT for a deposit and a custom rate per row', () => {
  assert.equal(lineVatAmount({qty:1,unitPrice:5000,vatRate:0}), 0);
  assert.equal(lineVatAmount({qty:2,unitPrice:15000,vatRate:5.5}), 1650);
});

test('per-line invoice without an aggregate computes its line sum', () => {
  const order = {
    vatMode:'per_line',
    vat: 'no',
    items: [
      {qty:2,unitPrice:10000,vatRate:8},
      {qty:1,unitPrice:5000,vatRate:0},
      {qty:2,unitPrice:15000,vatRate:5.5}
    ]
  };
  assert.equal(invoiceVatAmount(order), 3250);
});

test('legacy invoices without line rates keep their stored aggregate VAT', () => {
  assert.equal(invoiceVatAmount({
    vatAmount:1600, vat:'yes', items:[{qty:2,unitPrice:10000}]
  }), 1600);
});

test('legacy PDF line allocation reconciles exactly to the stored bill VAT', () => {
  const legacy = {vat:'yes',vatAmount:1,items:[
    {qty:1,unitPrice:7},{qty:1,unitPrice:7}
  ]};
  assert.equal(invoiceVatAmount(legacy),1);
  assert.equal(invoiceLineVatRate(legacy,0),7.14);
  assert.equal(invoiceLineVatAmount(legacy,0)+invoiceLineVatAmount(legacy,1),1);
});

test('invalid per-line rates fail instead of silently changing the total', () => {
  assert.throws(() => lineVatAmount({qty:1,unitPrice:10000,vatRate:100.01}));
  assert.throws(() => lineVatAmount({qty:1,unitPrice:10000,vatRate:1.234}));
});

test('website save and PDF paths carry per-line VAT fields', () => {
  assert.ok(html.includes('items: formVatItems()'));
  assert.ok(html.includes('const vatAmount = formVatAmount(goodsTotal)'));
  assert.ok(html.includes("+'% · '+money(rowVat)"), 'PDF line description must include VAT rate and amount');
  assert.match(html, /vatAmount:\s*totals\.vatAmount/);
});
