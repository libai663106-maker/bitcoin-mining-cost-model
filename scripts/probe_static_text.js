/* One-off audit: every [data-i18n] element's STATIC text in index.html vs the
 * i18n table's English value. The static copy is only a pre-JS fallback, but
 * when it drifts from the table the source of truth becomes ambiguous.
 * Usage: node scripts/probe_static_text.js
 */
const fs = require('fs'), path = require('path');

global.window = global.window || {};
require('./data.js');
global.window.I18N = undefined;
require('./i18n.js');
const I = global.window.I18N;
I.current = 'en';

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const re = /<([a-zA-Z0-9]+)\b[^>]*?data-i18n="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g;
/* Normalisers: the table value carries {n} tokens and inline <b> markup, and
   the HTML wraps across lines. Compare on meaning, not bytes:
   - fill {n} on both sides (any horizon behaves the same)
   - strip inline markup from both sides
   - collapse whitespace */
const norm = s => String(s)
  .split('{n}').join('4')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

let m, diffs = 0, total = 0, missing = [];
while ((m = re.exec(html)) !== null) {
  total++;
  const key = m[2];
  if (!I.has(key)) { missing.push(key); continue; }
  const have = norm(m[3]);
  const want = norm(I.t(key));
  if (have !== want) {
    diffs++;
    console.log('KEY ' + key);
    console.log('  html: ' + JSON.stringify(have.slice(0, 110)));
    console.log('  i18n: ' + JSON.stringify(want.slice(0, 110)));
  }
}
console.log('---');
console.log('elements with data-i18n: ' + total);
console.log('wording mismatches: ' + diffs);
console.log('keys missing from table: ' + (missing.length ? missing.join(', ') : 'none'));
