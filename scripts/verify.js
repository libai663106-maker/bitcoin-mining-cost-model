/* One-command acceptance run (§55). Executes every suite in order and prints a
 * single summary. Exits non-zero if anything fails.
 *
 *   node scripts/verify.js            full run
 *   node scripts/verify.js --fast     skip the browser-driven suites
 */
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FAST = process.argv.includes('--fast');

const SUITES = [
  { name: 'Engine unit tests (§09–§22)', file: 'test_engine.js', browser: false },
  { name: 'i18n table + locale invariants (§47)', file: 'test_i18n.js', browser: false },
  { name: 'Chart NaN / geometry probe (§26)', file: 'probe_charts.js', browser: false },
  { name: 'Indicator coverage (§55 acceptance)', file: 'test_indicators.js', browser: true },
  { name: 'Theme invariants (§45)', file: 'theme_invariants.js', browser: true },
  { name: 'Input reactivity (§55)', file: 'input_reactivity.js', browser: true },
  { name: 'Live / Manual switches (§36–§38)', file: 'test_live.js', browser: true },
  { name: 'Language switch invariants (§47)', file: 'probe_lang.js', browser: true }
];

/* Layout audits run with the locale passed in rather than inherited: labels
   set the minimum column width, so the English run is the worst case for
   horizontal overflow and the zh-CN run is the one the reader actually uses.
   Both are needed — a table that fits in English can still break in Chinese. */
const BROWSER_AUDITS = [
  { name: 'Desktop audit 1440 light en', args: ['audit.js', 'light', '1440', 'en'] },
  { name: 'Desktop audit 1440 light zh-CN', args: ['audit.js', 'light', '1440', 'zh-CN'] },
  { name: 'Tablet audit 768 light en', args: ['audit.js', 'light', '768', 'en'] },
  { name: 'Desktop audit 1440 dark', args: ['audit.js', 'dark', '1440', 'en'] },
  { name: 'Desktop audit 1440 tech', args: ['audit.js', 'tech', '1440', 'en'] },
  { name: 'Desktop audit 1440 minimal', args: ['audit.js', 'minimal', '1440', 'en'] }
];

/* Untranslated-copy audit. Runs per Chinese locale: the check is that a leaf
   with ASCII words but no CJK characters does not exist, which is the only
   honest way to catch copy that was never tagged. */
const LOCALE_AUDITS = [
  { name: 'Untranslated copy zh-CN (§47)', args: ['probe_locale_render.js', 'zh-CN'] },
  { name: 'Untranslated copy zh-TW (§47)', args: ['probe_locale_render.js', 'zh-TW'] }
];

const MOBILE_AUDITS = [
  { name: 'Mobile 390 light', args: ['mobile_audit.js', '390', 'light'] },
  { name: 'Mobile 390 dark', args: ['mobile_audit.js', '390', 'dark'] },
  { name: 'Mobile 390 tech', args: ['mobile_audit.js', '390', 'tech'] },
  { name: 'Mobile 390 minimal', args: ['mobile_audit.js', '390', 'minimal'] }
];

/* Heat-matrix suite runs once per theme: the diverging ramp resolves its tones
   through --chart-pos / --chart-neg, which differ in every theme. */
const HEAT_AUDITS = ['light', 'dark', 'tech', 'minimal'].map(t => ({
  name: 'Sensitivity heat ' + t + ' (§34)',
  args: ['test_heat.js', t]
}));

/* Label-collision sweep. Catches tick/caption overlaps that the contrast and
   geometry audits cannot see — a 1px descender clash still passes both. */
const COLLIDE_AUDITS = ['light', 'dark', 'tech', 'minimal'].map(t => ({
  name: 'Chart label collisions ' + t + ' (§24–§27)',
  args: ['probe_collide.js', t]
}));

/* One Chinese collision pass, because the chart copy is now localized and its
   labels differ in length from the English sources. A single theme is enough:
   --f-sans / --f-mono are declared once in tokens.css and no theme overrides
   them, so label geometry does not vary with colour. */
const COLLIDE_LOCALE_AUDITS = [
  { name: 'Chart label collisions zh-CN (§24–§27, §47)', args: ['probe_collide.js', 'light', 'zh-CN'] }
];

function run(label, rel, args) {
  process.stdout.write('\n' + '─'.repeat(58) + '\n' + label + '\n' + '─'.repeat(58) + '\n');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', rel)].concat(args || []), {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const lines = out.split(/\r?\n/);
  /* keep verdict + diagnostic lines, drop per-assertion noise */
  const keep = lines.filter(l =>
    /passed,|passed \/|failed|FAIL|SYNTAX|NaN=|errors=|LOW-CONTRAST|overflowing:|ERR |  theme=|  width=|ALL PASSED/.test(l));
  console.log(keep.length ? keep.join('\n') : out.slice(-400));
  return r.status === 0;
}

let ok = true;
for (const s of SUITES) {
  if (FAST && s.browser) continue;
  ok = run(s.name, s.file) && ok;
}
if (!FAST) {
  for (const a of BROWSER_AUDITS) {
    const passed = run(a.name, a.args[0], a.args.slice(1));
    ok = passed && ok;
  }
  for (const a of MOBILE_AUDITS) {
    const passed = run(a.name, a.args[0], a.args.slice(1));
    ok = passed && ok;
  }
  for (const a of HEAT_AUDITS) {
    const passed = run(a.name, a.args[0], a.args.slice(1));
    ok = passed && ok;
  }
  for (const a of COLLIDE_AUDITS) {
    const passed = run(a.name, a.args[0], a.args.slice(1));
    ok = passed && ok;
  }
  for (const a of COLLIDE_LOCALE_AUDITS) {
    const passed = run(a.name, a.args[0], a.args.slice(1));
    ok = passed && ok;
  }
  for (const a of LOCALE_AUDITS) {
    const passed = run(a.name, a.args[0], a.args.slice(1));
    ok = passed && ok;
  }
}

console.log('\n' + '═'.repeat(58));
console.log(ok ? '  ALL SUITES PASSED' : '  SOME SUITES FAILED — see above');
console.log('═'.repeat(58));
process.exit(ok ? 0 : 1);
