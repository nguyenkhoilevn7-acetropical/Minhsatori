// The live Apps Script source is never committed (public repo). This test uses
// the pre-VAT repository BotApi as a stand-in "live" file and a tampered copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tool = path.join(root, 'api/tools/port-optional-vat-to-live.mjs');
const base = execFileSync('git', ['-C', root, 'show', 'd48a60a:api/BotApi.gs'], {encoding: 'utf8'});
const squash = s => s.replace(/\s+/g, '');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vat-port-'));
const run = (input) => {
  const live = path.join(dir, 'live.js'), out = path.join(dir, 'out.js');
  fs.writeFileSync(live, input);
  const r = spawnSync(process.execPath, [tool, live, out], {encoding: 'utf8'});
  return {code: r.status, stdout: r.stdout, stderr: r.stderr, out: r.status === 0 ? fs.readFileSync(out, 'utf8') : ''};
};

test('ports only the VAT functions onto an indented live copy and keeps live-only code', () => {
  // Simulate the live editor's indentation and a live-only scope + function.
  const live = base.split('\n').map(l => '   ' + l).join('\n') +
    "\nvar LIVE_ONLY_MARKER={'pdf.get':'pdf:read'};\nfunction liveOnlyHelper(){return 1}\n";
  const r = run(live);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /PORT_OK/);
  assert.ok(r.out.includes('function normalizeInvoiceItems('));
  assert.ok(r.out.includes("'pdf.get':'pdf:read'") && r.out.includes('function liveOnlyHelper('));
  const repo = fs.readFileSync(path.join(root, 'api/BotApi.gs'), 'utf8');
  for (const name of ['sameCreateIntent', 'pairRequestIntent', 'updateUnpaidOrder'])
    assert.ok(squash(r.out).includes(squash(repo.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n}'))[0])), name);
  assert.match(squash(r.out), /result\.vatMode=o\.vatMode/);
  // Idempotent: porting the ported file again changes nothing.
  const again = run(r.out);
  assert.equal(again.code, 0, again.stderr);
  assert.equal(squash(again.out), squash(r.out));
});

test('refuses when a live function differs from the pre-VAT base (no guessing)', () => {
  const tampered = base.replace("function create(s,all,p,aiMode){", "function create(s,all,p,aiMode){var liveOnlyTweak=1;");
  const r = run(tampered);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /PORT_REFUSED: live function create/);
});
