/* i18n unit suite — the invariants that must hold for the language feature.
 *
 *   1. Every key in the table resolves in all three locales (no holes, no
 *      raw-key fallthrough that would print "hero.sub" into the UI).
 *   2. No duplicate key definitions — a duplicated object key silently wins
 *      the last write, which is how stale copy sneaks back in.
 *   3. Every key referenced by HTML or JS exists in the table.
 *   4. Traditional Chinese uses Taiwan vocabulary, not a naive 简→繁 mapping.
 *   5. `current` is validated, never trusted (a corrupt URL must not blank
 *      the UI by installing a locale with no strings).
 *   6. Formatting is locale-aware: grouping follows the locale and the null
 *      placeholder differs between English and Chinese.
 *   7. Switching language cannot move a number — the engine takes no locale
 *      input at all, which is the structural guarantee, and we prove it by
 *      running the same inputs under three locales and diffing every leaf.
 *
 * Run: node scripts/test_i18n.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else {
    fail++;
    const line = name + (extra !== undefined ? '   -> ' + JSON.stringify(extra) : '');
    failures.push(line);
    console.log('  FAIL  ' + line);
  }
}
function h(t) { console.log('\n== ' + t + ' =='); }

/* ------------------------------------------------------------------ */
/* module loading — UMD, so we supply a window and read the named export */
/* ------------------------------------------------------------------ */
const win = {};
global.window = win;
require(path.join(ROOT, 'scripts', 'i18n.js'));
require(path.join(ROOT, 'scripts', 'data.js'));
const I = win.I18N;
const D = win.AppData;

/* engine's UMD favours module.exports, which is what we want here */
const E = require(path.join(ROOT, 'scripts', 'engine.js'));

const LANGS = I.SUPPORTED;
const KEYS = I.keys();
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

/* ------------------------------------------------------------------ */
h('table integrity');
/* ------------------------------------------------------------------ */

ok('SUPPORTED covers three locales', LANGS.length === 3, LANGS);
ok('SUPPORTED has en / zh-CN / zh-TW',
  LANGS.indexOf('en') >= 0 && LANGS.indexOf('zh-CN') >= 0 && LANGS.indexOf('zh-TW') >= 0, LANGS);
ok('en is the declared fallback', I.DEFAULT_LANG === 'en', I.DEFAULT_LANG);
ok('table is non-trivial', KEYS.length > 300, KEYS.length);

/* Every key must resolve, in every locale, to a non-empty string that is
   not the key echoed back. */
const holes = [];
KEYS.forEach(function (k) {
  LANGS.forEach(function (l) {
    const v = I.t(k, l);
    if (typeof v !== 'string' || v === '' || v === k) holes.push(k + ' @ ' + l);
  });
});
ok('every key resolves in all locales (no holes)', holes.length === 0, holes.slice(0, 12));

/* Copy that names a column must name it the way the table names it. The
   hold-cost tooltip spells out its divisor ("all-in cost ÷ <production
   column>"), so renaming that column leaves the tooltip citing a heading the
   table no longer shows. The browser probe can only ever check the locale it
   pins (en), which is exactly the one a Chinese reader never sees — so the
   cross-reference is asserted here, per locale, with no browser involved. */
LANGS.forEach(function (l) {
  const hint = I.t('mdet.holdCostHint', l);
  const label = I.t('mdet.btc', l);
  ok('mdet.holdCostHint @ ' + l + ' cites the production column by its own label',
    hint.indexOf(label) >= 0, JSON.stringify([hint, label]));
});

/* The "{n}" horizon token is filled with the service life in YEARS — that is
   the only number `relabelDom` has to give it. This hint read "{n} months"
   once, so a four-year machine announced "4 months, hashrate-adjusted": the
   number was right and the unit was off by a factor of twelve, which reads
   perfectly and is wrong. The unit word is localised, so the check is per
   locale here rather than in the browser probe, which pins English. */
LANGS.forEach(function (l) {
  const hint = I.t('ch1.hint', l);
  ok('ch1.hint @ ' + l + ' names the unit the horizon token carries',
    /\{n\}/.test(hint) && /year|年/.test(hint) && !/month|个月|個月/i.test(hint), hint);
});

/* Same failure class, one panel over: the spot leg of "Mining vs Buy & Hold" is
   capital-matched, so the engine spends the machine AND the horizon's
   electricity on it. A note that names only the machine contradicts the figure
   printed directly above it — right number, wrong words. Both halves must be
   named, in every locale, and the horizon token carries YEARS, not months. */
const SPOT_MACHINE = { en: /machine/i, 'zh-CN': /矿机/, 'zh-TW': /礦機/ };
const SPOT_ELEC = { en: /electric/i, 'zh-CN': /电费/, 'zh-TW': /電費/ };
LANGS.forEach(function (l) {
  const note = I.t('vs.spotNote', l);
  ok('vs.spotNote @ ' + l + ' names both halves of the matched capital',
    /\{n\}/.test(note) && !/month|个月|個月/i.test(note)
    && SPOT_MACHINE[l].test(note) && SPOT_ELEC[l].test(note), note);
});

/* The reference sheet is a claim about the panel, so it has to divide by the
   same capital the panel does. This read "machine price ÷ BTC price" while the
   panel spent capex + electricity — a formula that documents a number the page
   no longer shows. */
LANGS.forEach(function (l) {
  const formula = I.t('fx.miningSpot', l);
  ok('fx.miningSpot @ ' + l + ' divides by the matched capital',
    /electric|电费|電費/.test(formula) && !/machine price|矿机价格|礦機價格/.test(formula),
    formula);
});

/* Chart 4 draws cumulative stacked bars — every band is an accumulator — and
   its tooltip already says 累计 / 累計 / cumulative. The panel title has to
   claim the same thing, because "Cost Breakdown" alone reads as a per-year
   split, which is the one thing this chart does not show. Tying the title to
   the word the tooltip uses (rather than to a literal) keeps the two in step:
   rename the axis vocabulary and the title has to follow. */
LANGS.forEach(function (l) {
  const title = I.t('ch4.title', l);
  const word = I.t('cg.cumulative', l);
  ok('ch4.title @ ' + l + ' claims the cumulation the chart draws',
    title.toLowerCase().indexOf(word.toLowerCase()) >= 0,
    JSON.stringify([title, word]));
});

/* No accidental duplicate keys — a duplicated object literal key silently
   wins the last definition, which is how stale copy sneaks back in. */
const src = read('scripts/i18n.js');
const declared = {};
const dupes = [];
const reKey = /^\s{4}'([\w.$-]+)':/gm;
let m;
while ((m = reKey.exec(src))) {
  if (declared[m[1]]) dupes.push(m[1]);
  declared[m[1]] = true;
}
ok('no duplicate key definitions in the source', dupes.length === 0, dupes);

/* ------------------------------------------------------------------ */
h('reference coverage');
/* ------------------------------------------------------------------ */

const refs = new Set();
const reAttr = /data-i18n(?:-title)?="([^"]+)"/g;
const html = read('index.html');
while ((m = reAttr.exec(html))) refs.add(m[1]);
const rePair = /data-i18n-attr="([^"]+)"/g;
while ((m = rePair.exec(html))) {
  m[1].split(',').forEach(function (p) {
    const i = p.indexOf(':');
    if (i >= 0) refs.add(p.slice(i + 1).trim());
  });
}
['scripts/app.js', 'scripts/charts.js', 'scripts/data.js', 'scripts/engine.js'].forEach(function (f) {
  const s = read(f);
  const re = /(?:\bI18N\.t|\bT|\btr|D\.tr)\(\s*'([a-zA-Z][\w.]*)'(?!\s*\+)/g;
  let mm;
  while ((mm = re.exec(s))) refs.add(mm[1]);
});
const missing = [...refs].filter(function (k) { return !I.has(k); });
ok('every referenced key is defined', missing.length === 0, missing);

const unused = KEYS.filter(function (k) { return !refs.has(k); });
console.log('  note  ' + unused.length + ' keys are dynamically composed or reserved');

/* ------------------------------------------------------------------ */
h('inline english fallbacks match the table');
/* ------------------------------------------------------------------ */

/* charts.js is loaded by the headless Node chart probes WITHOUT i18n, so its
   `T(key, fallback)` calls fall through to the literal. In the browser the
   table always wins — meaning a drifted fallback is invisible on the page and
   only shows up in the probe, which then asserts against a string the user
   never sees. That is how a probe stays green over a broken chart, so the two
   are pinned together: the inline fallback IS the English entry. */
const inline = [];
(function () {
  const re = /\b(?:I18N\.t|T)\(\s*'([a-zA-Z][\w.]*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*\)/g;
  const files = ['scripts/charts.js', 'scripts/app.js', 'scripts/data.js', 'scripts/engine.js'];
  files.forEach(function (f) {
    const s = read(f);
    let mm;
    while ((mm = re.exec(s))) inline.push({ file: f, key: mm[1], fb: mm[2] });
  });
})();
ok('the fallback scan actually found call sites', inline.length > 20, inline.length);
const fbBad = inline.filter(function (r) {
  return !I.has(r.key) || r.fb !== I.t(r.key, 'en');
}).map(function (r) {
  return r.key + ' @ ' + r.file + ': ' + JSON.stringify(r.fb) +
    (I.has(r.key) ? ' vs en ' + JSON.stringify(I.t(r.key, 'en')) : ' (key not in table)');
});
ok('every inline English fallback equals the en entry', fbBad.length === 0, fbBad.slice(0, 6));

/* ------------------------------------------------------------------ */
h('static fallbacks never promise a horizon');
/* ------------------------------------------------------------------ */

/* The no-JS text inside `data-i18n` elements is the other place copy can rot
   invisibly: `labelDom` overwrites it on boot, so the page always looks right
   and only the source carries the lie. Five had gone stale this way, every one
   of them by naming a horizon that is an input, not a constant — "BTC exit
   price (4-year)", "Mining BTC (48 months)", "…the 4-year projection…" (a panel
   that no longer exists). The horizon is `lifeYears`; a fallback that hardcodes
   one is wrong for every machine but the one it was written for.
   `pay.m18/24/48` are exempt by design: those presets ARE a fixed month count,
   which is the thing the button offers. */
const HORIZON_OK = /^pay\.m\d+$/;
const horizon = [];
(function () {
  const re = /data-i18n="([\w.]+)"[^>]*>([^<]*)/g;
  let mm;
  while ((mm = re.exec(html))) {
    if (HORIZON_OK.test(mm[1])) continue;
    if (/\d+\s*[-\u2011]?\s*(year|month|个月|個月)/i.test(mm[2])) {
      horizon.push(mm[1] + ': ' + mm[2].trim());
    }
  }
})();
ok('no static fallback hardcodes a horizon', horizon.length === 0, horizon);

/* A targeted pin rather than a sweep. The other static fallbacks differ from
   their en entries in wording only, and pinning all of them is a separate
   decision (a couple are deliberately shorter); but this one sits under the
   figure whose arithmetic just changed, and "the number moved while the caption
   stayed behind" is precisely the failure mode this suite exists to catch. */
(function () {
  const m = /data-i18n="vs\.spotNote"[^>]*>([^<]*)</.exec(html);
  ok('vs.spotNote static fallback is the en entry',
    !!m && m[1].trim() === I.t('vs.spotNote', 'en'), m ? m[1].trim() : null);
})();

/* ------------------------------------------------------------------ */
h('traditional chinese uses taiwan vocabulary');
/* ------------------------------------------------------------------ */

/* A naive 简→繁 conversion produces 網絡 / 哈希 / 開機率. Taiwan copy says
   網路 / 雜湊 / 線上率. These assertions stop a well-meaning bulk convert
   from silently regressing the whole zh-TW column. */
const TAIWAN_FORBIDDEN = [
  ['網絡', 'should be 網路'],
  ['哈希', 'should be 雜湊'],
  ['開機率', 'should be 線上率'],
  ['軟件', 'should be 軟體'],
  ['硬盤', 'should be 硬碟'],
  ['視頻', 'should be 影片'],
  ['信息', 'should be 資訊'],
  ['數據', 'should be 資料'],
  ['默認', 'should be 預設'],
  ['缺省', 'should be 預設'],
  ['質量', 'should be 品質'],
  ['在線', 'should be 線上']
];
const twBad = [];
KEYS.forEach(function (k) {
  const v = I.t(k, 'zh-TW');
  TAIWAN_FORBIDDEN.forEach(function (pair) {
    if (v.indexOf(pair[0]) >= 0) twBad.push(k + ': "' + pair[0] + '" ' + pair[1]);
  });
});
ok('no mainland-only vocabulary in zh-TW', twBad.length === 0, twBad.slice(0, 12));

/* Positive check: the Taiwan-specific terms we deliberately chose are present.
   Note "network hashrate" is 全網算力 in Taiwan usage — 網路 means "internet"
   specifically and would be wrong for a mining-network quantity. */
const twHasNet = KEYS.some(function (k) { return I.t(k, 'zh-TW').indexOf('全網算力') >= 0; });
ok('zh-TW uses 全網算力 for network hashrate', twHasNet);

/* 數據 → 資料 is the classic mainland/Taiwan split; make sure it holds. */
const twData = KEYS.some(function (k) { return I.t(k, 'zh-TW').indexOf('資料') >= 0; });
ok('zh-TW uses 資料 (not 數據)', twData);

/* Simplified column must not leak traditional-only forms back. */
const cnBad = [];
KEYS.forEach(function (k) {
  const v = I.t(k, 'zh-CN');
  if (v.indexOf('網路') >= 0 || v.indexOf('雜湊') >= 0 || v.indexOf('線上率') >= 0) {
    cnBad.push(k + ': ' + v.slice(0, 30));
  }
});
ok('zh-CN does not leak traditional-only forms', cnBad.length === 0, cnBad.slice(0, 8));

/* The two Chinese columns must actually differ for a meaningful share of the
   table — if they were identical the whole zh-TW column would be dead weight. */
const differing = KEYS.filter(function (k) { return I.t(k, 'zh-CN') !== I.t(k, 'zh-TW'); });
ok('zh-CN and zh-TW differ where they should', differing.length > 60, differing.length);

/* ------------------------------------------------------------------ */
h('locale selection is validated, never trusted');
/* ------------------------------------------------------------------ */

ok('normalize maps zh-cn to zh-CN', I.normalize('zh-cn') === 'zh-CN', I.normalize('zh-cn'));
ok('normalize maps zh-hans to zh-CN', I.normalize('zh-hans') === 'zh-CN', I.normalize('zh-hans'));
ok('normalize maps zh-sg to zh-CN', I.normalize('zh-sg') === 'zh-CN', I.normalize('zh-sg'));
ok('normalize maps zh-tw to zh-TW', I.normalize('zh-tw') === 'zh-TW', I.normalize('zh-tw'));
ok('normalize maps zh-hk to zh-TW', I.normalize('zh-hk') === 'zh-TW', I.normalize('zh-hk'));
ok('normalize maps zh-hant to zh-TW', I.normalize('zh-hant') === 'zh-TW', I.normalize('zh-hant'));
ok('normalize maps en-US to en', I.normalize('en-US') === 'en', I.normalize('en-US'));
ok('normalize rejects nonsense', !I.normalize('klingon'), I.normalize('klingon'));
ok('normalize tolerates empty input', !I.normalize(''), I.normalize(''));

const before = I.current;
I.current = 'xx-YY';
ok('unsupported locale is refused by the setter', I.current === before, I.current);
I.current = 'zh-TW';
ok('supported locale is accepted', I.current === 'zh-TW', I.current);
I.current = before;

/* ------------------------------------------------------------------ */
h('locale-aware formatting');
/* ------------------------------------------------------------------ */

ok('data.js exposes the locale helper', typeof D.tr === 'function');

I.current = 'en';
const enNull = D.fmtUSD(null);
const enGroup = D.fmtNum(1234567, 0);
I.current = 'zh-CN';
const cnNull = D.fmtUSD(null);
I.current = 'zh-TW';
const twNull = D.fmtUSD(null);
I.current = 'en';

ok('null placeholder is N/A in english', enNull === 'N/A', enNull);
ok('null placeholder is an em dash in zh-CN', cnNull === '—', cnNull);
ok('null placeholder is an em dash in zh-TW', twNull === '—', twNull);
ok('large numbers are grouped', /\d{1,3}[,\s\u00a0]\d{3}/.test(enGroup), enGroup);

/* tr() must fall back to the English literal when a key is unknown, so a
   Node run without a locale still produces readable output. */
ok('tr() falls back to the english literal for unknown keys',
  D.tr('definitely.not.a.key', 'fallback text') === 'fallback text');
ok('tr() resolves a real key', D.tr('unit.days', 'days') !== '');

/* The numbered-year label is a pattern, not a concatenation, because the word
   order flips between "Year 3" and "第 3 年". If someone ever reverts it to
   string glue, the English table would read "第 3" or the Chinese one "Year 3 years". */
ok('yearLabel is exposed for the table and the chart', typeof I.yearLabel === 'function');
I.current = 'en';
ok('yearLabel renders English order', I.yearLabel(3) === 'Year 3', I.yearLabel(3));
I.current = 'zh-CN';
ok('yearLabel renders Simplified order', I.yearLabel(3) === '第 3 年', I.yearLabel(3));
I.current = 'zh-TW';
ok('yearLabel renders Traditional order', I.yearLabel(3) === '第 3 年', I.yearLabel(3));
I.current = 'en';
ok('yearLabel leaves no unsubstituted token',
  I.yearLabel(11).indexOf('{n}') < 0 && /11/.test(I.yearLabel(11)), I.yearLabel(11));

/* The chart tooltip heading uses the same pattern for months. */
ok('monthLabel is exposed for the tooltips', typeof I.monthLabel === 'function');
I.current = 'en';
ok('monthLabel renders English order', I.monthLabel(7) === 'Month 7', I.monthLabel(7));
I.current = 'zh-CN';
ok('monthLabel renders Simplified order', I.monthLabel(7) === '第 7 月', I.monthLabel(7));
I.current = 'zh-TW';
ok('monthLabel renders Traditional order', I.monthLabel(7) === '第 7 月', I.monthLabel(7));
I.current = 'en';
ok('every {n} pattern key is fully substituted', (function () {
  const bad = [];
  ['proj.yearN', 'proj.monthN'].forEach(function (k) {
    ['en', 'zh-CN', 'zh-TW'].forEach(function (l) {
      const v = I.t(k, l);
      if (v.indexOf('{n}') < 0) bad.push(k + ' @ ' + l);   /* token missing entirely */
    });
  });
  return bad.length === 0;
})(), 'both numbered patterns carry the token');

/* Formatters must never emit NaN / Infinity for ordinary values. */
['fmtUSD', 'fmtBTC', 'fmtNum', 'fmtPct', 'fmtEH', 'fmtUSDCompact', 'fmtSats'].forEach(function (fn) {
  if (typeof D[fn] !== 'function') return;
  const out = String(D[fn](1234.5678));
  ok(fn + ' never emits NaN/Infinity', !/NaN|Infinity/.test(out), out);
});

/* ------------------------------------------------------------------ */
h('switching language cannot move the numbers');
/* ------------------------------------------------------------------ */

/* The engine takes no locale argument — that is the structural reason a
   language switch is a re-label, not a re-compute. Prove it by running the
   same inputs under three locales and diffing every leaf number. */
function baseInputs() {
  return {
    minerKey: 's23-305t',
    hashrate: 305,
    power: 3355,
    machinePrice: 7700,
    lifeYears: 4,
    btcPrice: 95000,
    networkHashrateEhs: 800,
    blockSubsidy: 3.125,
    hashrateGrowthAnnual: 0.25,
    btcGrowthAnnual: 0.10,
    electricityPrice: 0.06,
    uptime: 0.95,
    poolFee: 0.01,
    blockHeight: 870000,
    nextHalvingHeight: 1050000
  };
}

function digest(res) {
  const nums = [];
  (function walk(v, p) {
    if (v === null || v === undefined) return;
    if (typeof v === 'number') { nums.push(p + '=' + v); return; }
    if (typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(function (x, i) { walk(x, p + '[' + i + ']'); }); return; }
    Object.keys(v).forEach(function (k) { walk(v[k], p + '.' + k); });
  })(res, 'r');
  return nums.join('|');
}

let digestMismatch = null;
let base = null;
['en', 'zh-CN', 'zh-TW', 'en'].forEach(function (l) {
  I.current = l;
  const d = digest(E.simulate(baseInputs()));
  if (base === null) base = d;
  else if (d !== base && !digestMismatch) digestMismatch = { locale: l };
});
I.current = 'en';

ok('engine result is byte-identical across locales', !digestMismatch, digestMismatch);
ok('engine input keys contain no locale field',
  Object.keys(baseInputs()).every(function (k) { return !/lang|locale/i.test(k); }));

/* ------------------------------------------------------------------ */
h('no NaN / Infinity in the whole result tree');
/* ------------------------------------------------------------------ */

function badNumbers(res) {
  const bad = [];
  (function walk(v, p) {
    if (typeof v === 'number') { if (!isFinite(v)) bad.push(p + '=' + v); return; }
    if (v === null || v === undefined) return;
    if (typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(function (x, i) { walk(x, p + '[' + i + ']'); }); return; }
    Object.keys(v).forEach(function (k) { walk(v[k], p + '.' + k); });
  })(res, 'r');
  return bad;
}

ok('baseline model output is finite everywhere',
  badNumbers(E.simulate(baseInputs())).length === 0,
  badNumbers(E.simulate(baseInputs())).slice(0, 10));

/* Edge inputs must not produce NaN either — this is where cost models break. */
const EDGE = [
  { name: 'zero hashrate', over: { hashrate: 0 } },
  { name: 'zero power', over: { power: 0 } },
  { name: 'zero uptime', over: { uptime: 0 } },
  { name: 'zero btc price', over: { btcPrice: 0 } },
  { name: 'zero growth', over: { hashrateGrowthAnnual: 0, btcGrowthAnnual: 0 } },
  { name: 'zero life', over: { lifeYears: 0 } },
  { name: 'huge growth', over: { hashrateGrowthAnnual: 10 } },
  { name: 'negative growth', over: { hashrateGrowthAnnual: -0.9, btcGrowthAnnual: -0.9 } },
  { name: 'at halving height', over: { blockHeight: 1050000, nextHalvingHeight: 1050000 } },
  { name: 'past halving height', over: { blockHeight: 1100000, nextHalvingHeight: 1050000 } }
];
const edgeBad = [];
EDGE.forEach(function (c) {
  const inp = Object.assign(baseInputs(), c.over);
  const out = badNumbers(E.simulate(inp));
  if (out.length) edgeBad.push(c.name + ': ' + out.slice(0, 3).join(','));
});
ok('edge inputs never emit NaN/Infinity', edgeBad.length === 0, edgeBad);

/* ------------------------------------------------------------------ */
h('url carry');
/* ------------------------------------------------------------------ */

/* lang rides in the URL but must not land in the parsed model inputs, where
   the numeric coercion in fromQuery would turn the string into garbage. */
const q = E.toQuery(baseInputs());
ok('toQuery emits model params', q.indexOf('btcPrice=') >= 0, q.slice(0, 60));

const extra = E.fromQueryExtra('?lang=zh-TW&btcPrice=95000');
ok('fromQueryExtra reads lang', extra.lang === 'zh-TW', extra);

const parsed = E.fromQuery('?lang=zh-TW&btcPrice=95000');
ok('lang does NOT leak into numeric inputs',
  parsed.lang === undefined && !('lang' in parsed), Object.keys(parsed));

/* A round trip must preserve the model. */
const rt = E.fromQuery('?' + E.toQuery(baseInputs()));
ok('query round-trip preserves btcPrice', Number(rt.btcPrice) === 95000, rt.btcPrice);
ok('query round-trip preserves hashrate', Number(rt.hashrate) === 305, rt.hashrate);

/* ------------------------------------------------------------------ */
console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILED') + '  ' + pass + ' passed / ' + fail + ' failed');
if (fail) {
  console.log('\nfailures:');
  failures.forEach(function (f) { console.log('  - ' + f); });
}
process.exit(fail === 0 ? 0 : 1);
