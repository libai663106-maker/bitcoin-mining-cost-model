/* Render charts in a stubbed DOM-less harness to find NaN sources.
 * We re-implement the minimum globals charts.js needs.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

/* Syntax gate first: a stray `continue` inside a forEach callback parses fine
 * to the eye but throws at load time, which silently blanks every chart and
 * collapses the page. Cheap to catch here, expensive to debug in a screenshot.
 * In-process vm compile — spawning node.exe here hits EBUSY on Windows. */
['data.js', 'charts.js', 'app.js', 'engine.js'].forEach(f => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8');
  try { new vm.Script(src, { filename: f }); }
  catch (e) { console.error('SYNTAX FAIL in ' + f + ': ' + e.message); process.exit(1); }
});

const E = require('./engine.js');
const MARKET = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/market.json'), 'utf8'));

/* Token values come from tokens.css rather than a hand-copied table. The copy
 * had already drifted from the sheet (--chart-2 was #D97706 here against
 * #B45309 there), and an assertion written against a drifted stub checks a
 * colour the page never paints — which is worse than not checking at all. The
 * light theme is the reference block; every theme declares the same names.
 * Unknown names still resolve to 'currentColor' for the geometry checks. */
const TOK = (function () {
  const css = fs.readFileSync(path.join(ROOT, 'styles/tokens.css'), 'utf8');
  const at = css.indexOf('[data-theme="light"]');
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  const out = {};
  body.replace(/(--[\w-]+)\s*:\s*([^;]+);/g, (m, k, v) => { out[k] = v.trim(); return m; });
  return out;
})();

/* A missing token is a silent vacuous pass, not a missing check:
   `new RegExp(undefined)` compiles to /(?:)/ , which matches every string — so
   "chart 1 paints nothing in the BTC colour" would go RED and "draws the
   shutdown series" would go GREEN no matter what the chart contains. Fail at
   the door instead of asserting against a hole. */
['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6',
  '--chart-btc', '--chart-neg', '--chart-pos', '--chart-grid', '--chart-axis',
  '--card-bg', '--accent', '--tx', '--tx-4'].forEach(k => {
  if (!TOK[k]) { console.error('TOKEN MISSING from styles/tokens.css: ' + k); process.exit(1); }
});

global.window = {};
global.document = { documentElement: {} };
global.getComputedStyle = () => ({ getPropertyValue: n => TOK[n] || '' });

const fmtSrc = fs.readFileSync(path.join(ROOT, 'scripts/data.js'), 'utf8')
  .replace(/^\(function \(root\) \{/, '').replace(/\}\(window\)\);\s*$/, '');
/* data.js needs window.AppData; evaluate it with our stub window */
global.window = {};
eval(fs.readFileSync(path.join(ROOT, 'scripts/data.js'), 'utf8'));
const D = global.window.AppData;

/* charts.js: patch the tok()/alpha() it grabs from AppData */
D.tok = n => TOK[n] || 'currentColor';
D.alpha = (n, p) => `color-mix(in srgb,${TOK[n] || '#888'} ${p}%,transparent)`;

global.window.Charts = null;
eval(fs.readFileSync(path.join(ROOT, 'scripts/charts.js'), 'utf8'));
const C = global.window.Charts;

const BASE = {
  hashrate: 305, power: 3355, machinePrice: 7700, lifeYears: 4,
  networkHashrateEhs: MARKET.network_hashrate_ehs, blockSubsidy: MARKET.block_subsidy_btc,
  nextHalvingHeight: MARKET.next_halving_height, blocksPerHalving: MARKET.blocks_per_halving,
  blockHeight: MARKET.block_height, hashrateGrowthAnnual: 0.10, btcGrowthAnnual: 0.05,
  electricityPrice: 0.06, uptime: 0.97, poolFee: 0.01, btcPrice: MARKET.btc_price_usd,
  exitPrice: 200000,
  /* pinned so the chart geometry this probe inspects cannot drift with the
     wall clock — the horizon is calendar-anchored now */
  rackDate: '2026-10-05'
};

const res = E.simulate(BASE);

/* `inspect` used to print and nothing else, so this suite could never fail:
   a chart that started emitting NaN would still exit 0 and the gate would
   stay green. It now counts failures, which is what makes the cases below
   worth writing. */
let failures = 0;

function inspect(name, svg) {
  const nan = (svg.match(/NaN|Infinity|undefined/g) || []);
  const off = (svg.match(/(?:x|y|cx|cy|x1|x2|y1|y2)="-?\d{5,}"/g) || []);
  console.log(name.padEnd(16), 'NaN=' + nan.length, 'offlen=' + off.length, off.slice(0, 5).join(' '));
  if (nan.length) {
    const i = svg.indexOf('NaN');
    console.log('   context:', JSON.stringify(svg.slice(Math.max(0, i - 110), i + 60)));
  }
  if (nan.length || off.length) failures++;
}

function ok(name, cond, got) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   got: ' + JSON.stringify(got)));
  if (!cond) failures++;
}

inspect('priceVsShutdown', C.priceVsShutdown(res, res.current));
inspect('costPerBtc', C.costPerBtc(res));
inspect('hashrate', C.hashrate(res));
inspect('breakdown', C.breakdown(res));

const matrix = E.sensitivityCostMatrix(BASE, D.BTC_GROWTH_GRID, D.HASHRATE_GROWTH_GRID, { metric: 'ratio' });
inspect('sensitivity', C.sensitivity(res, matrix));
const elec = E.sensitivityElectricity(BASE, D.ELECTRICITY_GRID);
inspect('elecSens', C.elecSens(res, elec));

console.log('\n-- matrix values (Mining/Spot) --');
matrix.rows.forEach(r => console.log(' btc ' + (r.btcGrowth * 100) + '%:',
  r.cells.map(c => (c.v === null ? 'n/a' : (c.v * 100).toFixed(0) + '%')).join(' ')));
console.log('-- elec --');
elec.forEach(e => console.log(' $' + e.price, Math.round(e.costPerBtc), Math.round(e.shutdownPrice), e.breakEven));

/* ---------------------------------------------------------------------------
 * Chart 1 is single-series.
 *
 * Its BTC price line and that line's legend swatch were removed, leaving the
 * shutdown curve alone. Chart 1 also scales to the shutdown curve now instead
 * of sharing the axis with the BTC price, which is what makes the empty-range
 * case below reachable: the fallback used to be masked by a BTC price that
 * was always present.
 * ------------------------------------------------------------------------ */
console.log('\n-- chart 1 is single-series --');
{
  const c1 = C.priceVsShutdown(res, res.current);
  const lines = c1.match(/<path[^>]*fill="none"[^>]*stroke=/g) || [];
  /* Read the two colours off the sheet: chart 1's series is --chart-2 and the
     removed BTC line was --chart-btc. Hardcoding either hex would only be
     re-asserting the stub. */
  ok('chart 1 draws exactly one data line', lines.length === 1, lines.length);
  ok('chart 1 paints nothing in the BTC colour',
    !new RegExp(TOK['--chart-btc'], 'i').test(c1),
    { btc: TOK['--chart-btc'] });
  ok('chart 1 draws the shutdown series',
    new RegExp(TOK['--chart-2'], 'i').test(c1),
    { series: TOK['--chart-2'] });
  ok('chart 1 legend label is no longer "BTC price"',
    !/aria-label="[^"]*BTC price[^"]*"/i.test(c1), (c1.match(/aria-label="[^"]*"/) || [])[0]);
}

/* Zero output is a real state, not a curiosity: with no output at all every
   shutdown price in the whole horizon is null (§12), so chart 1 has an EMPTY
   value range. min/max of an empty set are ±Infinity and niceScale would be
   handed garbage — this case is the guard on that. */
console.log('\n-- zero-output state (uptime = 0) --');
{
  const dead = E.simulate(Object.assign({}, BASE, { uptime: 0 }));
  ok('every shutdown price is null at zero output (§12)',
    dead.rows.every(r => r.shutdownPrice === null), dead.rows[0].shutdownPrice);
  inspect('priceVsShutdown', C.priceVsShutdown(dead, dead.current));
  inspect('costPerBtc', C.costPerBtc(dead));
  inspect('breakdown', C.breakdown(dead));
}

console.log('\n' + (failures ? failures + ' FAILED' : 'ALL PASSED'));
process.exit(failures ? 1 : 0);
