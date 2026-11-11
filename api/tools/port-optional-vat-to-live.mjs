#!/usr/bin/env node
/**
 * Port the optional per-line VAT change onto the LIVE Apps Script BotApi
 * source, without copying the repository file over it.
 *
 * Why: the live project (clasp clone) has diverged from api/BotApi.gs in this
 * repository (live-only scopes such as pdf.get / orders.getExactBatch, a
 * different markPaid and paid()). Deploying api/BotApi.gs verbatim would drop
 * those. This tool changes ONLY the functions touched by the VAT work, and
 * only when the live function is identical (ignoring whitespace) to the
 * pre-VAT repository version. Anything else fails closed; nothing is guessed.
 *
 * Usage (read-only on the live clone; writes a new file):
 *   node api/tools/port-optional-vat-to-live.mjs <live BotApi.js> <out.js> [baseRef]
 * baseRef defaults to d48a60a (the commit the VAT chain #401 started from).
 * The live source is never committed: this repository is public.
 */
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const [livePath, outPath, baseRef = 'd48a60a'] = process.argv.slice(2);
if (!livePath || !outPath) {
  console.error('usage: port-optional-vat-to-live.mjs <live BotApi.js> <out.js> [baseRef]');
  process.exit(2);
}
const live = fs.readFileSync(livePath, 'utf8');
const next = fs.readFileSync(path.join(repoRoot, 'api/BotApi.gs'), 'utf8');
const base = execFileSync('git', ['-C', repoRoot, 'show', baseRef + ':api/BotApi.gs'], {encoding: 'utf8'});
const squash = text => text.replace(/\s+/g, '');
const fail = message => { console.error('PORT_REFUSED: ' + message); process.exit(1); };

/** Quote/comment-aware span of `function name(...){...}`; returns [start,end) or null. */
export function functionSpan(src, header) {
  const start = src.indexOf(header);
  if (start < 0 || src.indexOf(header, start + 1) >= 0) return null;
  let i = src.indexOf('{', start), depth = 0, quote = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return null; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; if (i <= 0) return null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return [start, i + 1];
  }
  return null;
}
const take = (src, header, label) => {
  const span = functionSpan(src, header);
  if (!span) fail(label + ': function not found exactly once: ' + header);
  return {span, text: src.slice(span[0], span[1])};
};

// Whole-function replacements: live must equal the pre-VAT base exactly.
const replaced = [
  'function sameCreateIntent(',
  'function pairRequestIntent(',
  'function create(s,all,p,aiMode)',
  'function updateUnpaidOrder(',
];
let out = live;
const report = [];
for (const header of replaced) {
  const l = take(out, header, 'live'), b = take(base, header, 'base'), n = take(next, header, 'repo');
  if (squash(l.text) === squash(n.text)) { report.push('already ported: ' + header); continue; }
  if (squash(l.text) !== squash(b.text))
    fail('live ' + header + ' differs from the pre-VAT base; port it manually after review');
  out = out.slice(0, l.span[0]) + n.text + out.slice(l.span[1]);
  report.push('replaced: ' + header);
}

// visible(): live differs from base (live-only fields), so add ONLY the two
// VAT fields the chain adds, by wrapping the live return object.
{
  const header = 'function visible(o)';
  const l = take(out, header, 'live');
  if (/result\.vatMode=o\.vatMode/.test(squash(l.text))) report.push('already ported: visible');
  else {
    const body = l.text;
    const m = body.match(/^function visible\(o\)\s*\{\s*return\s*(\{[\s\S]*\})\s*;?\s*\}$/);
    if (!m) fail('live visible(o) is not a single return-object function');
    const ported = 'function visible(o){var result=' + m[1] + ';\n' +
      ' if(o.vatMode!==undefined)result.vatMode=o.vatMode;\n' +
      ' if(o.vatRate!==undefined)result.vatRate=o.vatRate;\n' +
      ' return result;}';
    out = out.slice(0, l.span[0]) + ported + out.slice(l.span[1]);
    report.push('wrapped: visible (vatMode, vatRate added)');
  }
}

// New helpers go right after money(): copy them verbatim from the repo.
{
  const helpers = ['function invoiceVatRate(', 'function normalizeInvoiceItems('];
  const missing = helpers.filter(h => !out.includes(h));
  if (missing.length === 0) report.push('helpers already present');
  else {
    if (missing.length !== helpers.length) fail('only some VAT helpers exist in live; refusing partial state');
    const block = helpers.map(h => {
      const n = take(next, h, 'repo');
      // Keep the explanatory comment lines immediately above the helper.
      const before = next.slice(0, n.span[0]).split('\n');
      const comments = [];
      for (let i = before.length - 2; i >= 0 && /^\s*\/\//.test(before[i]); i--) comments.unshift(before[i]);
      return comments.join('\n') + (comments.length ? '\n' : '') + n.text;
    }).join('\n');
    const money = take(out, 'function money(', 'live');
    out = out.slice(0, money.span[1]) + '\n' + block + out.slice(money.span[1]);
    report.push('inserted: invoiceVatRate, normalizeInvoiceItems');
  }
}

fs.writeFileSync(outPath, out);
console.log(report.join('\n'));
console.log('PORT_OK ' + outPath + ' (' + out.length + ' chars; live was ' + live.length + ')');
