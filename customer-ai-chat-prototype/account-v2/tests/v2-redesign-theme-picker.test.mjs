import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The 2026-11-05 V2 redesign overlay must stay visual-only AND keep obeying the
// existing "Tùy chỉnh giao diện" picker (Teal/Indigo/Coral/custom colour, 2D/2.5D).
const accountV2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const redesignBlock = file => {
  const html = fs.readFileSync(path.join(accountV2, file), 'utf8');
  const match = html.match(/<style id="ms-v2-refresh-20261105">([\s\S]*?)<\/style>/);
  assert.ok(match, `${file}: redesign style block is missing`);
  return match[1];
};
const ruleBodies = (css, selectorPattern) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => selectorPattern.test(selector))
    .map(([, , body]) => body);

for (const file of ['app.html', 'owner-catalogue.html']) {
  test(`${file}: redesign brand tokens follow the UI25D picker variables`, () => {
    const css = redesignBlock(file);
    assert.match(css, /--ms-v2-forest:\s*var\(--s25-dark\)/);
    assert.match(css, /--ms-v2-teal:\s*var\(--s25-a\)/);
    assert.match(css, /--ms-v2-mint:\s*var\(--s25-soft\)/);
    assert.match(css, /html\[data-s25-depth="flat"\]\s*\{[^}]*var\(--s25-shadow\)/, '2D (flat) depth must flatten redesign shadows');
  });

  test(`${file}: themed controls never hardcode the teal accent`, () => {
    const css = redesignBlock(file);
    const themed = /(\.btn\.primary|\.checkout-submit|\.product-add|\.owner-header|owner-tabs button\[aria-selected|\.ai-avatar|\.mm-bottom-tab\.active|focus-visible|button:not\(\.secondary\))/;
    const bodies = ruleBodies(css, themed);
    assert.ok(bodies.length >= 2, 'expected themed rules in redesign block');
    for (const body of bodies) {
      assert.doesNotMatch(body, /(?:background|outline|color)\s*:[^;]*#0[0-9a-f]{5}/i, `hardcoded teal in: ${body.trim().slice(0, 90)}`);
      assert.doesNotMatch(body, /color\s*:\s*#fff(?:fff)?\b(?!\w)/i, `text on accent must use --s25-ink-on: ${body.trim().slice(0, 90)}`);
    }
  });
}

test('owner-catalogue.html: blanket button rule leaves the theme picker controls alone', () => {
  const css = redesignBlock('owner-catalogue.html');
  const blanket = css.match(/button:not\(\.secondary\):not\(\.danger\)[^{]*\{/);
  assert.ok(blanket, 'blanket button rule not found');
  for (const excluded of [':not(.s25-swatch)', ':not(.s25-picker-button)', ':not([data-s25-depth])']) {
    assert.ok(blanket[0].includes(excluded), `blanket button rule must exclude ${excluded}`);
  }
});

test('app.html: mobile login card fits inside the viewport', () => {
  const css = redesignBlock('app.html');
  const mobile = css.match(/@media screen and \(max-width:600px\)\{([\s\S]*?)\n\}/);
  assert.ok(mobile, 'mobile media block missing');
  const gate = mobile[1].match(/#gate\{([^}]*)\}/);
  assert.ok(gate, '#gate mobile rule missing');
  assert.match(gate[1], /width:calc\(100% - 24px\)/, 'a 12px margin needs a matching width, otherwise the card overflows by 12px');
});
