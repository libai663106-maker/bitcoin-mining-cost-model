/* Engine self-test. Run: node scripts/test_engine.js */
const E = require('./engine.js');
const M = require('../data/market.json');
/* data.js is a browser module, but its token reader is try/catch-guarded and it
   only touches window/document for colour lookup — a bare fake window is enough
   to reach the shipped constants. Loading it (rather than retyping the axis
   lists here) is the point: a test-local copy of the sensitivity ladder can only
   ever disagree with the product silently. test_i18n.js already does this. */
global.window = global.window || {};
require('./data.js');
const D = global.window.AppData;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '   -> ' + JSON.stringify(extra) : '')); }
}
function approx(a, b, tol, name) {
  const good = a !== null && isFinite(a) && Math.abs(a - b) <= Math.abs(tol);
  ok(name, good, { got: a, want: b });
}
function h(t) { console.log('\n== ' + t + ' =='); }

const BASE = {
  hashrate: 305, power: 3355, machinePrice: 7700, lifeYears: 4,
  networkHashrateEhs: M.network_hashrate_ehs, blockSubsidy: M.block_subsidy_btc,
  nextHalvingHeight: M.next_halving_height, blocksPerHalving: M.blocks_per_halving,
  blockHeight: M.block_height, hashrateGrowthAnnual: 0.10, btcGrowthAnnual: 0.05,
  electricityPrice: 0.06, uptime: 0.97, poolFee: 0.01, btcPrice: M.btc_price_usd,
  exitPrice: 200000,
  /* Pinned so the day counts can't drift with the wall clock: the month
     windows are calendar-shaped now, so an unpinned rack date would make
     every window-length assertion a different value tomorrow. */
  rackDate: '2026-10-05'
};

/* ---------- 1. formula hand-checks with round numbers ---------- */
h('1. Hand-computed formula checks (exact round numbers)');
{
  const I = Object.assign({}, BASE, {
    hashrate: 100, power: 3000, machinePrice: 10000, lifeYears: 4,
    networkHashrateEhs: 1000, blockSubsidy: 3.125,
    electricityPrice: 0.05, uptime: 1, poolFee: 0, btcPrice: 100000
  });
  const F = E.computeCurrent(I);
  // btcPerThDay = 3.125*144/(1000*1e6) = 450/1e9 = 4.5e-7
  approx(F.btcPerThDay, 4.5e-7, 1e-14, 'BTC/TH/day = 4.5e-7');
  // minerBtc = 4.5e-7 * 100 = 4.5e-5
  approx(F.minerBtcDay, 4.5e-5, 1e-12, 'Miner BTC/day = 0.000045');
  // elec = 3 * 24 * 0.05 = 3.6
  approx(F.dailyElectricity, 3.6, 1e-9, 'Daily electricity = $3.60');
  // machine = 10000/1460
  approx(F.dailyMachineCost, 10000 / 1460, 1e-9, 'Daily machine cost = $6.8493');
  approx(F.dailyTotalCost, 3.6 + 10000 / 1460, 1e-9, 'Daily total cost = $10.4493');
  /* Both bases must be published explicitly. "Cost" everywhere in this model is
     ALL-IN (electricity + straight-line depreciation); the cash line that the
     §12 shutdown decision turns on is carried separately and must never leak
     into the headline numbers. */
  approx(F.dailyCashCost, F.dailyElectricity, 1e-12, 'cash basis = electricity alone');
  approx(F.dailyFullCost, F.dailyMachineCost + F.dailyElectricity, 1e-12, 'full basis = electricity + depreciation');
  approx(F.dailyTotalCost, F.dailyFullCost, 1e-12, 'dailyTotalCost is the all-in basis');
  approx(F.dailyNetProfit, F.dailyRevenue - F.dailyFullCost, 1e-12, 'daily net profit is all-in');
  approx(F.dailyCashNetProfit, F.dailyRevenue - F.dailyElectricity, 1e-12, 'daily cash flow excludes capex');
  approx(F.shutdownPrice, F.cashShutdownPrice + 10000 / 1460 / 4.5e-5, 1e-4,
    'full break-even sits above the cash break-even by depreciation/BTC');
  // revenue = 4.5e-5 * 100000 = 4.5
  approx(F.dailyRevenue, 4.5, 1e-9, 'Daily revenue = $4.50');
  approx(F.dailyNetProfit, 4.5 - (3.6 + 10000 / 1460), 1e-9, 'Daily net profit = -$5.9493');
  // shutdown = 10.4493 / 4.5e-5 = 232,207.6...
  approx(F.shutdownPrice, (3.6 + 10000 / 1460) / 4.5e-5, 1e-4, 'Shutdown price = $232,207.6');
  approx(F.costRatio, (3.6 + 10000 / 1460) / 4.5, 1e-9, 'Cost ratio = 232.2%');
  /* Cash payback here is $10,000 ÷ $0.90 = 11,111 days — far beyond the 4-year
     service life, so it reports null rather than a date the machine can never
     reach. (The all-in profit is negative too, but cash is what payback means.) */
  ok('Static payback = null when it outruns the service life', F.staticPaybackDays === null, F.staticPaybackDays);
  ok('Efficiency = 30 J/TH', Math.abs(F.efficiency_jth - 30) < 1e-9, F.efficiency_jth);
  // 18M payback = (10000/540 + 3.6)/4.5e-5
  approx(F.payback18, (10000 / 540 + 3.6) / 4.5e-5, 1e-3, '18M payback price');
  approx(F.payback48, (10000 / 1440 + 3.6) / 4.5e-5, 1e-3, '48M payback price');
}

/* ---------- 2. profitable case: hand-check with 1 TH/s ---------- */
h('2. Hand-computed profitable case');
{
  const I = {
    hashrate: 1, power: 20, machinePrice: 1000, lifeYears: 4,
    networkHashrateEhs: 1000, blockSubsidy: 3.125, blocksPerHalving: 210000,
    blockHeight: 969947, nextHalvingHeight: 1050000,
    hashrateGrowthAnnual: 0, btcGrowthAnnual: 0,
    electricityPrice: 0.05, uptime: 1, poolFee: 0, btcPrice: 500000, exitPrice: 500000
  };
  const F = E.computeCurrent(I);
  // btc/day = 4.5e-7 ; revenue = 4.5e-7*5e5 = 0.225
  approx(F.dailyRevenue, 0.225, 1e-12, 'Revenue $0.225/day');
  // elec = 0.02*24*0.05 = 0.024 ; machine = 1000/1460 = 0.68493
  approx(F.dailyElectricity, 0.024, 1e-12, 'Electricity $0.024/day');
  approx(F.dailyNetProfit, 0.225 - 0.024 - 1000 / 1460, 1e-9, 'Net profit negative (machine cost dominates)');
  // shutdown = (0.024+0.68493)/4.5e-7 = 1,575,413
  approx(F.shutdownPrice, (0.024 + 1000 / 1460) / 4.5e-7, 1e-4, 'Shutdown price $1,575,413');
}

/* ---------- 3. degenerate / guard cases (spec §52) ---------- */
h('3. Guards — no NaN / Infinity / negative output');
{
  const I = Object.assign({}, BASE, { networkHashrateEhs: 0 });
  const F = E.computeCurrent(I);
  ok('networkHashrate=0 → btcPerThDay=0 (not NaN)', F.btcPerThDay === 0, F.btcPerThDay);
  ok('networkHashrate=0 → minerBtc=0', F.minerBtcDay === 0, F.minerBtcDay);
  ok('networkHashrate=0 → shutdown=null (not Infinity)', F.shutdownPrice === null, F.shutdownPrice);
  ok('networkHashrate=0 → costRatio=null', F.costRatio === null, F.costRatio);
  const r = E.simulate(I);
  ok('  simulation survives', r.summary.cumBtc === 0, r.summary.cumBtc);
  ok('  actualCostPerBtc=null (not Infinity)', r.summary.actualCostPerBtc === null, r.summary.actualCostPerBtc);
  ok('  vs.ratio=null', r.vs.ratio === null, r.vs.ratio);
  ok('  miningRoi finite', isFinite(r.vs.miningRoi), r.vs.miningRoi);
  const scan = JSON.stringify(r, (k, v) => {
    if (typeof v === 'number' && !isFinite(v)) return 'BAD:' + v;
    return v;
  });
  ok('  no non-finite numbers anywhere in result', scan.indexOf('BAD:') === -1, scan.slice(0, 200));
}
{
  const I = Object.assign({}, BASE, { hashrate: 0 });
  const F = E.computeCurrent(I);
  ok('hashrate=0 → minerBtc=0', F.minerBtcDay === 0);
  ok('hashrate=0 → dailyMachineCost still finite', isFinite(F.dailyMachineCost));
  ok('hashrate=0 → staticPayback null', F.staticPaybackDays === null);
}
{
  const I = Object.assign({}, BASE, { btcPrice: 0 });
  const F = E.computeCurrent(I);
  ok('btcPrice=0 → costRatio null', F.costRatio === null, F.costRatio);
  ok('btcPrice=0 → staticPayback null', F.staticPaybackDays === null);
  const r = E.simulate(I);
  ok('btcPrice=0 → spotBtc null', r.vs.spotBtc === null, r.vs.spotBtc);
  ok('btcPrice=0 → ratio null', r.vs.ratio === null);
  ok('btcPrice=0 → spotRoi null', r.vs.spotRoi === null, r.vs.spotRoi);
}
{
  const I = Object.assign({}, BASE, { electricityPrice: 0, poolFee: 0, uptime: 1, btcPrice: 1e9 });
  const r = E.simulate(I);
  ok('extreme profit → finite', isFinite(r.vs.miningRoi) && isFinite(r.summary.actualCostPerBtc));
  ok('extreme profit → static payback positive', r.current.staticPaybackDays > 0, r.current.staticPaybackDays);
}
{
  /* Output contract: charts read baselines off `result.current`. If the engine
     drops these echoes the hashrate axis silently collapses to 0..1 (guarded
     NaN path) and renders "0 0 0 1 1 1" — regression B-3. */
  const r = E.simulate(BASE);
  ok('current.btcPrice echoed', r.current.btcPrice === BASE.btcPrice, r.current.btcPrice);
  ok('current.networkHashrateEhs echoed', r.current.networkHashrateEhs === BASE.networkHashrateEhs, r.current.networkHashrateEhs);
  ok('current.networkHashrateEhs finite', isFinite(r.current.networkHashrateEhs));
  ok('summary.networkHashrateEnd > start', r.summary.networkHashrateEnd > r.current.networkHashrateEhs);
}
{
  const I = Object.assign({}, BASE, { lifeYears: 0 });
  const r = E.simulate(I);
  const scan = JSON.stringify(r, (k, v) => (typeof v === 'number' && !isFinite(v)) ? 'BAD' : v);
  ok('lifeYears=0 → no non-finite', scan.indexOf('BAD') === -1);
}
{
  const I = Object.assign({}, BASE, { hashrateGrowthAnnual: -1 });
  const r = E.simulate(I);
  const scan = JSON.stringify(r, (k, v) => (typeof v === 'number' && !isFinite(v)) ? 'BAD' : v);
  ok('hashrateGrowth=-100% → no non-finite', scan.indexOf('BAD') === -1);
}

/* ---------- 4. monotonicity / sanity ---------- */
h('4. Monotonicity');
{
  const b = E.simulate(BASE);
  const higherGrowth = E.simulate(Object.assign({}, BASE, { hashrateGrowthAnnual: 0.30 }));
  ok('higher hashrate growth → fewer BTC',
    higherGrowth.summary.cumBtc < b.summary.cumBtc,
    { hi: higherGrowth.summary.cumBtc, base: b.summary.cumBtc });
  ok('higher hashrate growth → higher cost/BTC',
    higherGrowth.summary.actualCostPerBtc > b.summary.actualCostPerBtc);

  const cheapElec = E.simulate(Object.assign({}, BASE, { electricityPrice: 0.03 }));
  ok('cheaper electricity → lower shutdown price',
    cheapElec.current.shutdownPrice < b.current.shutdownPrice);
  ok('cheaper electricity → lower cost/BTC', cheapElec.summary.actualCostPerBtc < b.summary.actualCostPerBtc);

  const cheapMiner = E.simulate(Object.assign({}, BASE, { machinePrice: 3000 }));
  ok('cheaper machine → lower cost/BTC', cheapMiner.summary.actualCostPerBtc < b.summary.actualCostPerBtc);

  const big = E.simulate(Object.assign({}, BASE, { hashrate: 610 }));
  ok('double hashrate → ~2x BTC', Math.abs(big.summary.cumBtc / b.summary.cumBtc - 2) < 1e-6);

  /* Derived, not hardcoded: this used to read `479`, which was only half of the
     snapshot's hashrate at the time. When the market file was refreshed to
     960.3 the assertion started failing for a reason that had nothing to do
     with the model. Data-dependent constants must come from the data. */
  const priv = E.simulate(Object.assign({}, BASE, { networkHashrateEhs: BASE.networkHashrateEhs / 2 }));
  ok('half network → ~2x BTC', Math.abs(priv.summary.cumBtc / b.summary.cumBtc - 2) < 1e-3,
    priv.summary.cumBtc / b.summary.cumBtc);
}

/* ---------- 5. halving behaviour ---------- */
h('5. Halving');
{
  const near = E.simulate(Object.assign({}, BASE, {
    blockHeight: 1040000, nextHalvingHeight: 1050000, hashrateGrowthAnnual: 0, btcGrowthAnnual: 0
  }));
  ok('halving detected inside the horizon', near.summary.halvingMonth !== null, near.summary.halvingMonth);
  const hm = near.summary.halvingMonth;
  const before = near.rows[hm - 2].blockSubsidy;
  const at = near.rows[hm - 1].blockSubsidy;
  const after = near.rows[hm].blockSubsidy;
  ok('subsidy step: pre=3.125, partial month between, post=1.5625',
    Math.abs(before - 3.125) < 1e-9 && at < 3.125 && at > 1.5625 && Math.abs(after - 1.5625) < 1e-9,
    { before, at, after });
  /* Windows are real calendar months now (28–31 days), so month-to-month BTC
     ratios must be compared PER DAY — otherwise a 31-day month looks like it
     escaped the halving. */
  const perDay = (x) => x.btc / x.days;
  const stepRatio = perDay(near.rows[hm - 1]) / perDay(near.rows[hm - 2]);
  ok('halving cuts daily BTC by 0–50%', stepRatio >= 0.5 - 1e-9 && stepRatio < 1, stepRatio);
  const nextRatio = perDay(near.rows[hm]) / perDay(near.rows[hm - 2]);
  ok('month after halving produces ~50% per day', Math.abs(nextRatio - 0.5) < 1e-9, nextRatio);
  /* A halving is 210,000 blocks = 1458.3 days away. That is INSIDE a real
     4-year (1461-day) service life but OUTSIDE the 48×30 = 1440 days the model
     used to project — the flat-30 convention quietly dropped the last three
     weeks of the machine's life, and with them the second halving. Anchoring
     the horizon to the calendar is what surfaces it. */
  const far = E.simulate(Object.assign({}, BASE, {
    blockHeight: 1050000, nextHalvingHeight: E.nextHalvingHeight(1050000, 210000),
    hashrateGrowthAnnual: 0, btcGrowthAnnual: 0
  }));
  ok('a halving 1458 days out lands inside a real 4-year horizon',
    far.summary.halvingMonth !== null, far.summary.halvingMonth);
  ok('  its window blends the two subsidies rather than stepping cleanly',
    far.rows[far.summary.halvingMonth - 1].blockSubsidy < 3.125,
    far.rows[far.summary.halvingMonth - 1].blockSubsidy);
  ok('subsidy helper: era 0', Math.abs(E.blockSubsidy(100, 50, 210000) - 50) < 1e-12);
  ok('subsidy helper: era 3 (post 2024)', Math.abs(E.blockSubsidy(969947, 50, 210000) - 3.125) < 1e-12);
  ok('nextHalvingHeight from 969947', E.nextHalvingHeight(969947, 210000) === 1050000);
}

/* ---------- 6. cost decomposition identity ---------- */
h('6. Identities');
{
  const r = E.simulate(BASE);
  const s = r.summary;
  approx(s.totalCost, s.machineCost + s.cumElectricity, 1e-6, 'totalCost = machine + Σelectricity');
  approx(s.netProfit, s.revenue - s.totalCost, 1e-6, 'netProfit = revenue - totalCost');
  approx(s.actualCostPerBtc, s.totalCost / s.cumBtc, 1e-9, 'cost/BTC = totalCost / cumBtc');
  const ySum = r.years.reduce((a, y) => a + y.btc, 0);
  approx(ySum, s.cumBtc, 1e-9, 'Σannual BTC = cumulative BTC');
  const mSum = r.rows.reduce((a, x) => a + x.btc, 0);
  approx(mSum, s.cumBtc, 1e-9, 'Σmonthly BTC = cumulative BTC');
  const mElec = r.rows.reduce((a, x) => a + x.electricity, 0);
  approx(mElec, s.cumElectricity, 1e-6, 'Σmonthly electricity = cumulative electricity');
  /* Capex is amortised inside the grid rather than dropped in at the summary,
     so the monthly column, the annual column and the 4-year summary carry the
     SAME money. If these ever diverge again the projection table stops adding
     up against the headline — which is exactly the bug this pins. */
  const mCost = r.rows.reduce((a, x) => a + x.totalCost, 0);
  approx(mCost, s.totalCost, 1e-6, 'Σmonthly totalCost = summary.totalCost');
  approx(mCost, s.machineCost + mElec, 1e-6, 'Σmonthly totalCost = capex + Σelectricity');
  const mDep = r.rows.reduce((a, x) => a + x.machineCost, 0);
  approx(mDep, s.machineCost, 1e-6, 'Σmonthly depreciation = machine price (charged once)');
  const yCost = r.years.reduce((a, y) => a + y.totalCost, 0);
  approx(yCost, s.totalCost, 1e-6, 'Σannual totalCost = summary.totalCost (table reconciles)');
  const yElec = r.years.reduce((a, y) => a + y.electricity, 0);
  ok('annual rows are not two copies of the same column',
    r.years.every(y => Math.abs(y.totalCost - y.electricity) > 1e-6), r.years[0]);
  ok('monthly rows carry both bases',
    r.rows.every(x => Math.abs(x.cashNetProfit - (x.revenue - x.cashCost)) < 1e-6)
    && r.rows.every(x => Math.abs(x.netProfit - (x.revenue - x.totalCost)) < 1e-6),
    r.rows[0]);
  approx(r.rows[r.rows.length - 1].unitCost, s.actualCostPerBtc, 1e-6,
    'running cost/BTC converges on the headline figure');
  approx(r.vs.miningRoi, (r.vs.miningBtc * r.vs.exitPrice - s.totalCost) / s.totalCost, 1e-9, 'mining ROI formula');
  approx(r.vs.spotRoi, (200000 - BASE.btcPrice) / BASE.btcPrice, 1e-12, 'spot ROI formula');
  approx(r.vs.ratio, r.vs.miningBtc / r.vs.spotBtc, 1e-12, 'Mining/Spot ratio');
  /* Capital-matched buy & hold. The spot leg spends the SAME total capital the
     mining route does — the machine plus every electricity bill in the horizon —
     converted once at today's price. Pricing it off the machine alone handed the
     mining side its opex for free, AND it made this ratio contradict the two
     "BTC per $1M spent" rows printed in the same panel: those were already
     capital-matched, so the headline and the rows disagreed by exactly the
     electricity share (here 7700 vs 14547 — a 134% headline over a 71% pair).
     Both sides of that identity are asserted, off one run. */
  approx(r.vs.spotBtc * BASE.btcPrice, s.totalCost, 1e-6,
    'spot BTC = matched capital (capex + horizon electricity) ÷ today price');
  approx(r.vs.spotBtc * BASE.btcPrice, s.machineCost + s.cumElectricity, 1e-6,
    'matched capital = capex + Σ electricity');
  ok('spot BTC is no longer the machine-only figure',
    r.vs.spotBtc > BASE.machinePrice / BASE.btcPrice,
    { matched: r.vs.spotBtc, machineOnly: BASE.machinePrice / BASE.btcPrice });
  approx(r.vs.ratio, r.vs.miningValuePerCost * BASE.btcPrice, 1e-12,
    'ratio = BTC per $ mined ÷ BTC per $ bought (the panel prints both)');
  {
    const short = E.simulate(Object.assign({}, BASE, { lifeYears: 3 }));
    ok('a shorter horizon carries fewer electricity bills into the spot leg',
      short.vs.spotBtc < r.vs.spotBtc, { y3: short.vs.spotBtc, y4: r.vs.spotBtc });
    approx(short.vs.spotBtc * BASE.btcPrice, short.summary.totalCost, 1e-6,
      'and the y3 spot leg matches the y3 capital');
  }
  ok('48 months produced', r.rows.length === 48, r.rows.length);
  ok('no negative BTC anywhere', r.rows.every(x => x.btc >= 0));
  ok('no negative electricity anywhere', r.rows.every(x => x.electricity >= 0));
}

/* ---------- 7. static payback vs simulated payback consistency ---------- */
h('7. Static payback cross-check');
{
  const I = Object.assign({}, BASE, {
    hashrateGrowthAnnual: 0, btcGrowthAnnual: 0, electricityPrice: 0.02, btcPrice: 150000,
    uptime: 1, poolFee: 0
  });
  const r = E.simulate(I);
  const sp = r.current.staticPaybackDays;
  if (sp !== null && sp < 1460) {
    /* Walk the real day counts to find the window that contains the static
       payback day — a flat ÷30 would land on the wrong month now that windows
       are 28–31 days. */
    let acc = 0, idx = r.rows.length;
    for (let i = 0; i < r.rows.length; i++) {
      acc += r.rows[i].days;
      if (acc >= sp) { idx = i + 1; break; }
    }
    const cumNet = r.rows.slice(0, idx).reduce((a, x) => a + x.cashNetProfit, 0);
    ok('static payback ≈ simulated payback (cum cash > 0 at that month)', cumNet > 0,
      { staticDays: sp, cumDayAtMonth: acc, cumNetAtMonth: cumNet });
  } else {
    ok('static payback undefined or beyond life — skipping', true);
  }
  // both shutdown prices are the cash break-even (electricity-only daily cost)
  const flat = E.simulate(Object.assign({}, I, { hashrateGrowthAnnual: 0, btcGrowthAnnual: 0 }));
  approx(flat.rows[0].shutdownPrice, flat.current.shutdownPrice, 1e-9,
    'month-1 shutdown price = current shutdown price (flat growth)');
  approx(flat.rows[0].shutdownPrice, flat.current.dailyElectricity / flat.current.minerBtcDay, 1e-9,
    'shutdown price = daily electricity ÷ daily BTC');
  /* The two lines must not be conflated: the 4-year model reports the CASH
     break-even (§12, what a shutdown call compares against), while the all-in
     break-even stays available separately. */
  ok('sim shutdown = cash break-even, not the all-in line',
    Math.abs(flat.current.shutdownPrice - flat.current.cashShutdownPrice) < 1e-9
    && Math.abs(flat.current.shutdownPrice - flat.current.fullCostPerBtc) > 1,
    { cash: flat.current.shutdownPrice, allIn: flat.current.fullCostPerBtc });
}

/* ---------- 8. URL round-trip ---------- */
h('8. URL state');
{
  const q = E.toQuery({
    hashrate: 305, power: 3355, machinePrice: 7700, btcPrice: 84500,
    networkHashrateEhs: 957.97, electricityPrice: 0.06, uptime: 0.97, poolFee: 0.01,
    hashrateGrowthAnnual: 0.10, btcGrowthAnnual: 0.05, lifeYears: 4, exitPrice: 200000,
    minerKey: 'custom'
  });
  const back = E.fromQuery(q, {});
  ok('round-trip hashrate', back.hashrate === 305, back.hashrate);
  ok('round-trip networkHashrateEhs', Math.abs(back.networkHashrateEhs - 957.97) < 1e-9, back.networkHashrateEhs);
  ok('round-trip electricityPrice', Math.abs(back.electricityPrice - 0.06) < 1e-12, back.electricityPrice);
  ok('round-trip uptime', Math.abs(back.uptime - 0.97) < 1e-12, back.uptime);
  ok('custom miner key omitted from query', q.indexOf('miner=') === -1, q);
  const named = E.toQuery({ minerKey: 's21xp', hashrate: 305 });
  ok('named miner key present in query', named.indexOf('miner=s21xp') >= 0, named);
  const empty = E.fromQuery('', { hashrate: 1 });
  ok('empty query keeps defaults', empty.hashrate === 1);
  const greedy = E.fromQuery('hashrate=abc&power=3000', {});
  ok('non-numeric ignored', greedy.power === 3000);
}

/* ---------- 9. sensitivity ---------- */
h('9. Sensitivity');
{
  /* The sensitivity ladder is a spec value, not an implementation detail: the
     matrix is only readable if both axes carry the same 10-point rungs. Pin the
     list itself here, then derive every shape/count/index below from it, so a
     future ladder change fails in one obvious place instead of silently
     shifting what rows[3] means. */
  const AXIS = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
  const GRID = D.BTC_GROWTH_GRID, HGRID = D.HASHRATE_GROWTH_GRID;
  const N = GRID.length, C = HGRID.length;
  ok('BTC-growth axis is 0/10/20/30/40/50 %', JSON.stringify(GRID) === JSON.stringify(AXIS), GRID);
  ok('hashrate-growth axis is 0/10/20/30/40/50 %', JSON.stringify(HGRID) === JSON.stringify(AXIS), HGRID);

  const m = E.sensitivityCostMatrix(BASE, GRID, HGRID, { metric: 'netPerBtc' });
  ok('matrix shape matches the two axes', m.rows.length === N && m.rows.every(r => r.cells.length === C),
    { rows: m.rows.length, cols: m.rows[0] && m.rows[0].cells.length });
  ok('matrix row labels echo the BTC axis in order',
    m.rows.every((r, i) => r.btcGrowth === GRID[i]), m.rows.map(r => r.btcGrowth));
  ok('matrix column headers echo the hashrate axis in order',
    JSON.stringify(m.cols) === JSON.stringify(HGRID), m.cols);
  /* 36 cells at 50% hashrate growth is the far corner of the ladder — the one
     place an unbounded compounding assumption would show up as Infinity. */
  ok('matrix all finite (incl. the 0%/50% corner)',
    m.rows.every(r => r.cells.every(c => isFinite(c.v))),
    m.rows.map(r => r.cells.map(c => Math.round(c.v)).join()).join(' | '));
  ok('netPerBtc rises with BTC growth (col 0)',
    m.rows[0].cells[0].v < m.rows[N - 1].cells[0].v,
    m.rows.map(r => Math.round(r.cells[0].v)).join());
  ok('netPerBtc falls with hashrate growth (last row)',
    m.rows[N - 1].cells[0].v > m.rows[N - 1].cells[C - 1].v,
    m.rows[N - 1].cells.map(c => Math.round(c.v)).join());
  ok('netPerBtc changes at every rung on both axes',
    m.rows.every((r, i) => i === 0 || r.cells[0].v > m.rows[i - 1].cells[0].v) &&
    m.rows[0].cells.every((c, j) => j === 0 || c.v < m.rows[0].cells[j - 1].v),
    'strictly monotone along both axes');
  ok('cost/BTC unchanged by BTC growth (documented limitation)',
    Math.abs(m.rows[0].cells[0].cost - m.rows[N - 1].cells[0].cost) < 1e-9,
    { r0: m.rows[0].cells[0].cost, r5: m.rows[N - 1].cells[0].cost });
  ok('cost/BTC rises at every hashrate rung',
    m.rows[1].cells.every((c, j) => j === 0 || c.cost > m.rows[1].cells[j - 1].cost),
    m.rows[1].cells.map(c => Math.round(c.cost)).join(' < '));
  ok('realised BTC price rises with BTC growth',
    m.rows[0].cells[0].realisedPrice < m.rows[N - 1].cells[0].realisedPrice,
    m.rows.map(r => Math.round(r.cells[0].realisedPrice)).join());

  const e = E.sensitivityElectricity(BASE, [0.03, 0.06]);
  ok('electricity sensitivity decreasing', e[0].costPerBtc < e[1].costPerBtc);
  ok('cheap electricity profitable, dear less so', e[0].dailyProfit > e[1].dailyProfit);
}

/* ---------- 10. real-world snapshot sanity ---------- */
h('10. Live snapshot sanity (S23 305T @ $0.06)');
{
  const r = E.simulate(BASE);
  console.log('   BTC/TH/day        ', r.current.btcPerThDay.toExponential(4));
  console.log('   Miner BTC/day     ', r.current.minerBtcDay.toFixed(8));
  console.log('   Daily revenue     $', r.current.dailyRevenue.toFixed(3));
  console.log('   Daily electricity $', r.current.dailyElectricity.toFixed(3));
  console.log('   Daily machine     $', r.current.dailyMachineCost.toFixed(3));
  console.log('   Daily total cost  $', r.current.dailyTotalCost.toFixed(3));
  console.log('   Daily net profit  $', r.current.dailyNetProfit.toFixed(3));
  console.log('   Cost / BTC        $', Math.round(r.summary.actualCostPerBtc));
  console.log('   Shutdown price    $', Math.round(r.current.shutdownPrice));
  console.log('   Cost ratio        ', (r.current.costRatio * 100).toFixed(1) + '%');
  console.log('   4Y BTC            ', r.summary.cumBtc.toFixed(5));
  console.log('   4Y cost / BTC     $', Math.round(r.summary.actualCostPerBtc));
  console.log('   Spot BTC (matched)', r.vs.spotBtc.toFixed(6), '= $' + Math.round(r.summary.totalCost) + ' ÷ spot price');
  console.log('   Mining / Spot     ', (r.vs.ratio * 100).toFixed(1) + '%');
  console.log('   Mining ROI        ', (r.vs.miningRoi * 100).toFixed(1) + '%');
  ok('spot leg is capital-matched at the shipped default',
    Math.abs(r.vs.spotBtc * BASE.btcPrice - r.summary.totalCost) < 1e-6,
    { spotUsd: r.vs.spotBtc * BASE.btcPrice, totalCost: r.summary.totalCost });
  ok('BTC/TH/day in plausible range (1e-7..1e-6)', r.current.btcPerThDay > 1e-7 && r.current.btcPerThDay < 1e-6,
    r.current.btcPerThDay);
  ok('shutdown price plausible (10k..1M)', r.current.shutdownPrice > 1e4 && r.current.shutdownPrice < 1e6,
    r.current.shutdownPrice);
  ok('cost/BTC plausible (10k..1M)', r.summary.actualCostPerBtc > 1e4 && r.summary.actualCostPerBtc < 1e6,
    r.summary.actualCostPerBtc);
  console.log('   Daily cash flow   $', r.current.dailyCashNetProfit.toFixed(3));
  console.log('   Static payback    ', Math.round(r.current.staticPaybackDays) + ' days');
  ok('static payback is a cash payback inside the service life',
    r.current.staticPaybackDays > 0 && r.current.staticPaybackDays <= 4 * 365,
    r.current.staticPaybackDays);
  approx(r.current.staticPaybackDays, BASE.machinePrice / r.current.dailyCashNetProfit, 1e-6,
    'static payback = machine price ÷ daily cash flow (capex not charged twice)');
}

/* ---------- 11. calendar horizon & monthly cost detail ---------- */
h('11. Calendar horizon (rack date → real month windows)');
{
  const r = E.simulate(BASE);
  const C = r.calendar;

  /* 4 years from 2026-10-05 ends 2030-10-04 and is 1461 days, not 48×30 = 1440.
     The flat-30 convention silently dropped three weeks of the machine's life —
     and with them the second halving (see §5). */
  ok('48 windows for a 4-year life', C.windows === 48, C.windows);
  ok('rack date is the anchor', C.rackDate === '2026-10-05', C.rackDate);
  ok('horizon ends 2030-10-04', C.horizonEnd === '2030-10-04', C.horizonEnd);
  ok('4-year life is 1461 days, not 1440', C.totalDays === 1461, C.totalDays);
  approx(r.summary.totalDays, 1461, 0, 'summary.totalDays exposed');
  ok('Σ window days = total days',
    r.rows.reduce((a, x) => a + x.days, 0) === C.totalDays);
  ok('Σ annual days = total days',
    r.years.reduce((a, y) => a + y.days, 0) === C.totalDays);
  /* Real calendar months, so February is short and January is long. */
  const daySet = r.rows.map(x => x.days);
  ok('day counts are real calendar months (28–31)',
    daySet.every(d => d >= 28 && d <= 31) && new Set(daySet).size > 1,
    Array.from(new Set(daySet)).sort().join('/'));
  ok('a February carries 28 days somewhere in 4 years', daySet.indexOf(28) >= 0, daySet.join(','));
  ok('windows are contiguous',
    r.rows.every((x, i) => i === 0 || E.daysBetween(E.parseISODate(r.rows[i - 1].dateEnd), E.parseISODate(x.dateStart)) === 1));
  /* Month arithmetic must clamp, not roll over. */
  ok('addMonths clamps Jan 31 + 1M → Feb 28',
    E.toISODate(E.addMonths(E.parseISODate('2026-01-31'), 1)) === '2026-02-28',
    E.toISODate(E.addMonths(E.parseISODate('2026-01-31'), 1)));
  ok('addMonths handles a leap February',
    E.toISODate(E.addMonths(E.parseISODate('2028-01-31'), 1)) === '2028-02-29',
    E.toISODate(E.addMonths(E.parseISODate('2028-01-31'), 1)));
  ok('unparseable rack date falls back instead of producing NaN',
    isFinite(E.simulate(Object.assign({}, BASE, { rackDate: 'not-a-date' })).summary.totalDays));

  /* The horizon is the service life: one input, not two. */
  const three = E.simulate(Object.assign({}, BASE, { lifeYears: 3 }));
  ok('lifeYears drives the window count', three.calendar.windows === 36, three.calendar.windows);
  /* 1096, not 3×365 = 1095: the window straddles the Feb 2028 leap day and the
     calendar — not the nominal year — decides how many days get billed. */
  ok('3-year life is the real day span (1096, it contains a leap day)',
    three.calendar.totalDays === 1096, three.calendar.totalDays);
  ok('calendar horizon = rack date + N months, day for day',
    three.calendar.totalDays === E.daysBetween(
      E.parseISODate(three.calendar.rackDate),
      E.addMonths(E.parseISODate(three.calendar.rackDate), 36)));
}

h('12. Monthly cost detail (halving split into two lines)');
{
  const r = E.simulate(BASE);
  const D = r.detailRows;

  ok('one detail line per month, plus one extra per halving',
    D.length === r.rows.length + r.calendar.halvings,
    { detail: D.length, month: r.rows.length, halvings: r.calendar.halvings });
  ok('exactly one halving inside a 4-year horizon from 2026-10-05',
    r.calendar.halvings === 1, r.calendar.halvings);

  const split = D.filter(x => x.split);
  ok('the halving month is the only split month', split.length === 2, split.length);
  ok('split lines are labelled part 1 and 2 of the same month',
    split[0].month === split[1].month && split[0].part === 1 && split[1].part === 2);
  ok('split lines carry the two distinct subsidies',
    Math.abs(split[0].blockSubsidy - 3.125) < 1e-12 && Math.abs(split[1].blockSubsidy - 1.5625) < 1e-12,
    { pre: split[0].blockSubsidy, post: split[1].blockSubsidy });
  ok('post-halving line produces half per T per day',
    Math.abs(split[1].btcPerThDay / split[0].btcPerThDay - 0.5) < 1e-12);
  /* The split date is derived from the block height, never hardcoded — and it
     must agree with the snapshot's own estimate. */
  ok('the split lands on the halving date the block height implies',
    split[1].dateStart === '2028-04-13', split[1].dateStart);
  ok('the two halves are contiguous and add up to the month',
    E.daysBetween(E.parseISODate(split[0].dateEnd), E.parseISODate(split[1].dateStart)) === 1);
  const month19 = r.rows[split[0].month - 1];
  ok('split days sum to the month length', split[0].days + split[1].days === month19.days,
    { a: split[0].days, b: split[1].days, month: month19.days });
  ok('the split month sits between the two subsidies',
    month19.blockSubsidy < 3.125 && month19.blockSubsidy > 1.5625, month19.blockSubsidy);

  /* The detail table and the month table must be the SAME money. Any drift here
     is the two-tables-disagree bug in a new costume. */
  ok('every detail row has a positive day count',
    D.every(x => x.days > 0), D.filter(x => !(x.days > 0)).length);
  ok('Σ detail days = Σ month days = horizon days',
    D.reduce((a, x) => a + x.days, 0) === r.rows.reduce((a, x) => a + x.days, 0)
    && D.reduce((a, x) => a + x.days, 0) === r.summary.totalDays);
  const acc = {};
  D.forEach(x => {
    const a = acc[x.month] = acc[x.month] || { days: 0, btc: 0, elec: 0, cost: 0, machine: 0, rev: 0 };
    a.days += x.days; a.btc += x.btc; a.elec += x.electricity;
    a.cost += x.totalCost; a.machine += x.machineCost; a.rev += x.revenue;
  });
  ok('Σ detail BTC = month BTC (per month)',
    r.rows.every(mo => Math.abs(acc[mo.month].btc - mo.btc) < 1e-15),
    r.rows.map(mo => Math.abs(acc[mo.month].btc - mo.btc)).reduce((a, b) => Math.max(a, b), 0));
  ok('Σ detail electricity = month electricity',
    r.rows.every(mo => Math.abs(acc[mo.month].elec - mo.electricity) < 1e-9));
  ok('Σ detail totalCost = month totalCost',
    r.rows.every(mo => Math.abs(acc[mo.month].cost - mo.totalCost) < 1e-9));
  ok('Σ detail depreciation = month depreciation',
    r.rows.every(mo => Math.abs(acc[mo.month].machine - mo.machineCost) < 1e-9));
  ok('Σ detail revenue = month revenue',
    r.rows.every(mo => Math.abs(acc[mo.month].rev - mo.revenue) < 1e-9));
  /* Depreciation is spread by DAYS, so the parts reconcile to the machine price. */
  approx(D.reduce((a, x) => a + x.machineCost, 0), BASE.machinePrice, 1e-6,
    'Σ detail depreciation = machine price (spread by days, charged once)');

  /* Column semantics for the eleven columns the detail table shows. */
  const f = D[0];
  ok('detail row carries a start and end date', !!f.dateStart && !!f.dateEnd, f.dateStart + '→' + f.dateEnd);
  ok('no period is ever emitted without dates',
    D.every(x => /^\d{4}-\d{2}-\d{2}$/.test(x.dateStart) && /^\d{4}-\d{2}-\d{2}$/.test(x.dateEnd)),
    D.filter(x => !x.dateStart || !x.dateEnd).length);
  ok('detail dates span the day count',
    E.daysBetween(E.parseISODate(f.dateStart), E.parseISODate(f.dateEnd)) === f.days - 1);
  ok('implied hashrate round-trips to the assumed hashrate',
    Math.abs(f.impliedHashrateEhs - f.networkHashrate) / f.networkHashrate < 1e-12,
    { implied: f.impliedHashrateEhs, assumed: f.networkHashrate });
  ok('implied hashrate holds on every row',
    D.every(x => Math.abs(x.impliedHashrateEhs - x.networkHashrate) / x.networkHashrate < 1e-12));
  ok('每T日产出 = subsidy × 144 ÷ (netTh × 1e6)',
    Math.abs(f.btcPerThDay - f.blockSubsidy * 144 / (f.networkHashrate * 1e6)) < 1e-18);
  ok('关机币价 is the cash break-even (electricity ÷ BTC)',
    Math.abs(f.shutdownPrice - f.electricity / f.btc) < 1e-9);
  ok('挖矿综合成本 = 电费 + 折旧', Math.abs(f.totalCost - (f.electricity + f.machineCost)) < 1e-9);
  ok('成本占比 = 综合成本 ÷ 当月收入', Math.abs(f.costRatio - f.totalCost / f.revenue) < 1e-12);
  ok('月实际产量 scales with the day count',
    Math.abs(f.btc - f.btcPerThDay * BASE.hashrate * f.days * BASE.uptime * (1 - BASE.poolFee)) < 1e-18);
  ok('月电费 scales with the day count',
    Math.abs(f.electricity - BASE.power / 1000 * 24 * f.days * BASE.electricityPrice * BASE.uptime) < 1e-9);

  /* --- 期数: the first column numbers PERIODS, not months ------------- */
  ok('期数 runs 1..N in order down the table', D.every((x, i) => x.period === i + 1),
    D.map(x => x.period).slice(0, 3));
  ok('calendar.periods equals the line count', r.calendar.periods === D.length,
    { calendar: r.calendar.periods, lines: D.length });
  ok('the halving month advances 期数 by two, not one',
    split[1].period === split[0].period + 1, split.map(x => x.period));
  ok('期数 is strictly increasing, so no two rows share a number',
    D.every((x, i) => i === 0 || x.period > D[i - 1].period));

  /* --- 综合持仓成本: this period's all-in cost ÷ its own BTC --------- */
  ok('综合持仓成本 = 当期综合成本 ÷ 当期实际产量',
    D.every(x => x.unitCost === null || Math.abs(x.unitCost - x.totalCost / x.btc) < 1e-9),
    D.filter(x => x.unitCost !== null && Math.abs(x.unitCost - x.totalCost / x.btc) >= 1e-9).length);
  ok('every period with production carries a cost basis',
    D.every(x => x.btc > 0 ? isFinite(x.unitCost) : x.unitCost === null),
    D.filter(x => x.btc > 0 && !isFinite(x.unitCost)).length);
  ok('the pre-halving period holds coins cheaper than the post-halving one',
    split[0].unitCost < split[1].unitCost, { pre: split[0].unitCost, post: split[1].unitCost });
  ok('一个不拆分的期的持仓成本 = 该月的 monthUnitCost',
    r.rows.every(mo => {
      const parts = D.filter(x => x.month === mo.month);
      return parts.length !== 1 || Math.abs(parts[0].unitCost - mo.monthUnitCost) < 1e-9;
    }));
  /* The new column's total row must land on the KPI's end-of-life figure. */
  approx(D.reduce((a, x) => a + x.totalCost, 0) / D.reduce((a, x) => a + x.btc, 0),
    r.summary.actualCostPerBtc, 1e-9,
    'Σ detail cost ÷ Σ detail BTC = summary.actualCostPerBtc (the KPI end label)');

  /* --- the endpoint rule: no split at the month's first or last day --- */
  {
    /* Constructed from the calendar and the block height rather than from any
       remembered date, and on a 6-month horizon so the NEXT halving (210,000
       blocks ≈ 1458 days out) cannot land inside the window and muddy the
       count. */
    const w1 = E.monthWindows(E.parseISODate(BASE.rackDate), 1)[0];
    const short = Object.assign({}, BASE, { lifeYears: 0.5 });
    const plain = E.simulate(short);
    const atStart = E.simulate(Object.assign({}, short, { nextHalvingHeight: BASE.blockHeight }));
    const atEnd = E.simulate(Object.assign({}, short, { nextHalvingHeight: BASE.blockHeight + 144 * w1.days }));
    ok('6-month horizon = 6 periods before any halving',
      plain.calendar.periods === 6, plain.calendar.periods);
    ok('a halving on the month\'s FIRST day does not split it',
      atStart.calendar.periods === 6 && atStart.calendar.halvings === 0,
      { periods: atStart.calendar.periods, halvings: atStart.calendar.halvings });
    ok('  ... and that month is post-halving from its first line',
      Math.abs(atStart.detailRows[0].blockSubsidy - 1.5625) < 1e-12,
      atStart.detailRows[0].blockSubsidy);
    ok('a halving on the month\'s LAST day does not split it either',
      atEnd.calendar.periods === 6 && atEnd.calendar.halvings === 0,
      { periods: atEnd.calendar.periods, halvings: atEnd.calendar.halvings });
    ok('  ... and the split month\'s coins still add up to its month row',
      atEnd.rows.every(mo => {
        const parts = atEnd.detailRows.filter(x => x.month === mo.month);
        return Math.abs(parts.reduce((a, x) => a + x.btc, 0) - mo.btc) < 1e-15;
      }));
    /* A sub-day sliver of pre-halving rounds to zero days, so it must not be
       billed as a period of its own — the month stays one post-halving line. */
    const sliver = E.simulate(Object.assign({}, short, { nextHalvingHeight: BASE.blockHeight + 1 }));
    ok('a sub-day sliver does not become its own period',
      sliver.calendar.periods === 6 && sliver.detailRows[0].blockSubsidy === 1.5625,
      { periods: sliver.calendar.periods, sub: sliver.detailRows[0].blockSubsidy });
    ok('  ... and that month is still billed in full',
      sliver.detailRows[0].days === w1.days && sliver.detailRows[0].dateStart === BASE.rackDate,
      { days: sliver.detailRows[0].days, want: w1.days });
    const mid = E.simulate(Object.assign({}, short, {
      nextHalvingHeight: BASE.blockHeight + 144 * Math.floor(w1.days / 2)
    }));
    ok('a halving truly inside the month DOES split it',
      mid.calendar.periods === 7 && mid.calendar.halvings === 1,
      { periods: mid.calendar.periods, halvings: mid.calendar.halvings });
  }

  /* Guards. */
  const zero = E.simulate(Object.assign({}, BASE, { networkHashrateEhs: 0 }));
  ok('no BTC → shutdownPrice null, costRatio null, not Infinity',
    zero.detailRows.every(x => x.shutdownPrice === null && (x.revenue === 0 ? x.costRatio === null : true)));
  ok('no BTC → 持仓成本 null on every period, never Infinity',
    zero.detailRows.every(x => x.unitCost === null),
    zero.detailRows.filter(x => x.unitCost !== null).length);
  const scan = JSON.stringify(r, (k, v) => (typeof v === 'number' && !isFinite(v)) ? 'BAD' : v);
  ok('no non-finite number anywhere in calendar or detail output', scan.indexOf('BAD') === -1);
}

/* ---------- 13. shipped defaults ---------- */
h('13. Shipped defaults — one value, not two copies');
{
  /* The form starts from data.js `DEFAULTS`; the engine re-states the same
     numbers as its absent-input fallbacks. Those are two copies of one
     contract, so they are compared here rather than trusted — editing a
     default in one file and not the other changes nothing visible on the page
     (the app always passes a full input set) and nothing in the docs. */
  const SKIP = {
    minerKey: 'not a model input — the engine never sees the machine catalogue',
    rackDate: 'deliberately different: absent → today, not a frozen build date',
    months: 'derived from lifeYears, asserted separately below'
  };
  const bare = E.simulate({}).input;
  const drift = [];
  Object.keys(D.DEFAULTS).forEach(function (k) {
    if (SKIP[k]) return;
    if (bare[k] !== D.DEFAULTS[k]) drift.push({ k: k, engine: bare[k], form: D.DEFAULTS[k] });
  });
  ok('every shipped default is the same in engine.js and data.js', drift.length === 0, drift);
  ok('the skip list has no stale entries (each skipped key still exists)',
    Object.keys(SKIP).every(k => Object.prototype.hasOwnProperty.call(D.DEFAULTS, k)),
    Object.keys(SKIP).filter(k => !Object.prototype.hasOwnProperty.call(D.DEFAULTS, k)));
  ok('months follows lifeYears, not the other way round',
    bare.months === D.DEFAULTS.lifeYears * 12, { months: bare.months, lifeYears: bare.lifeYears });

  /* The three values changed on 2026-10-05, pinned at the value (not the
     default-derivation) so a future edit has to be deliberate. */
  ok('uptime default is 95%', D.DEFAULTS.uptime === 0.95, D.DEFAULTS.uptime);
  ok('BTC-growth default is 20%', D.DEFAULTS.btcGrowthAnnual === 0.20, D.DEFAULTS.btcGrowthAnnual);
  /* 20% happens to be a rung of the sensitivity ladder. Pin that it is a
     coincidence of two independent lists, not a dependency: the ladder must
     still be the ladder even though this default now sits on it. */
  ok('the BTC-growth default sitting on a ladder rung changes nothing about the ladder',
    JSON.stringify(D.BTC_GROWTH_GRID) === JSON.stringify([0, 0.10, 0.20, 0.30, 0.40, 0.50]),
    D.BTC_GROWTH_GRID);
}

/* ---------- 14. Simulated machine payback month ---------- */
h('14. Machine payback month (§14 on the simulated path)');
{
  /* §14's static payback is machinePrice ÷ today's daily cash flow. The monthly
     table draws the same idea on the actual curve (halving + hashrate growth),
     so the payback month is the first month whose cumulative revenue −
     electricity has covered the machine price. Under the shipped defaults that
     month does NOT exist — the halving cuts the reward before the capex is
     recovered — so the crossing is pinned on a deliberately cheap machine and
     the null case is pinned separately. */
  function crossing(r) {
    var run = 0;
    for (var i = 0; i < r.rows.length; i++) {
      run += r.rows[i].revenue - r.rows[i].electricity;
      if (run >= r.summary.machineCost) return r.rows[i].month;
    }
    return null;
  }
  {
    const r = E.simulate(Object.assign({}, BASE, { machinePrice: 1000 }));
    const pm = r.summary.paybackMonth;
    ok('a cheap machine pays back within the horizon', Number.isInteger(pm) && pm >= 1, pm);
    ok('payback month == the first month cumulative cash covers the machine',
      pm === crossing(r), { paybackMonth: pm, derived: crossing(r) });
    ok('the month before payback is still short of the machine price',
      pm > 1 ? (function () {
        var b = 0; for (var i = 0; i < pm - 1; i++) b += r.rows[i].revenue - r.rows[i].electricity;
        return b < r.summary.machineCost;
      })() : true,
      'before-month cash vs machine price');
  }
  {
    /* The shipped machine (S23 305T @ $7,700) never gets its capex back on the
       simulated curve, so the marker must be absent, not a made-up month. */
    const r = E.simulate(BASE);
    ok('the shipped config never recovers capex → payback month is null',
      r.summary.paybackMonth === null, r.summary.paybackMonth);
  }
  {
    const r = E.simulate(Object.assign({}, BASE, { machinePrice: 1e12 }));
    ok('an unreachable machine price leaves payback month null',
      r.summary.paybackMonth === null, r.summary.paybackMonth);
  }
  {
    const r = E.simulate(Object.assign({}, BASE, { machinePrice: 1 }));
    ok('a $1 machine pays back in the first month',
      r.summary.paybackMonth === 1, r.summary.paybackMonth);
  }
}

console.log('\n---------------------------------------');
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('---------------------------------------');
process.exit(fail ? 1 : 0);
