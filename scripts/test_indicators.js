/* Spec §55 acceptance: every indicator the brief names must actually be on the
 * page, carry a finite value, and update when an input changes.
 *
 * The other suites verify *behaviour* (reactivity, theme invariants, contrast).
 * This one verifies *presence and coverage* against the named metric list, which
 * is what §03 / §09 / §53 / §56 ask for — those are requirements about what the
 * page exposes, and nothing else was asserting them.
 *
 * Run: node scripts/test_indicators.js [theme]
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const THEME = process.argv[2] || 'light';
const PORT = 8930 + Math.floor(Math.random() * 120);
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png'
};

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '   -> ' + JSON.stringify(extra) : '')); }
}
function h(t) { console.log('\n== ' + t + ' =='); }

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});

function cdp(ws, method, params, sessionId) {
  return new Promise((resolve, reject) => {
    const id = cdp._id = (cdp._id || 0) + 1;
    const msg = { id, method, params: params || {} };
    if (sessionId) msg.sessionId = sessionId;
    const onMsg = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id !== id) return;
      ws.removeEventListener('message', onMsg);
      m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify(msg));
  });
}

const PROBE = `(function(){
  function txt(el){ return el ? (el.textContent||'').replace(/\\s+/g,' ').trim() : null; }
  function byId(id){ return txt(document.getElementById(id)); }
  function rows(tbodyId){
    var tb = document.getElementById(tbodyId);
    if (!tb) return [];
    var out = [];
    var trs = tb.querySelectorAll('tr');
    for (var i=0;i<trs.length;i++){
      var tds = trs[i].querySelectorAll('td,th');
      if (tds.length >= 2) out.push({ k: txt(tds[0]), v: txt(tds[1]) });
      else if (tds.length === 1) out.push({ k: txt(tds[0]), v: txt(tds[0]) });
    }
    return out;
  }
  /* the monthly detail table has ten columns, so the two-cell rows() helper
     is not enough — keep every cell of every row (no backticks here: this whole
     block lives inside a template literal) */
  function grid(tbodyId){
    var tb = document.getElementById(tbodyId);
    if (!tb) return [];
    var out = [], trs = tb.querySelectorAll('tr');
    for (var i=0;i<trs.length;i++){
      var tds = trs[i].querySelectorAll('td');
      if (!tds.length) continue;
      out.push({
        cells: Array.prototype.map.call(tds, function(c){ return txt(c); }),
        /* Day count lives in the <small> under the dates. Read it out of THAT
           cell rather than out of the first <small> in the row: the footer
           carries its own <small> (the period count) in cell 1. */
        days: (function(){
          var c = tds[1] || tds[0];
          var s = c.querySelector('small');
          var m = s ? /(\\d+)/.exec(txt(s)) : null;
          return m ? Number(m[1]) : null;
        })(),
        split: String(trs[i].className).indexOf('split') >= 0,
        total: String(trs[i].className).indexOf('total') >= 0
      });
    }
    return out;
  }
  /* the payback tables may be plain markup, so fall back
     to scanning every table on the page */
  function allTables(){
    var out = [];
    var ts = document.querySelectorAll('table');
    for (var i=0;i<ts.length;i++){
      var trs = ts[i].querySelectorAll('tr');
      for (var j=0;j<trs.length;j++){
        var tds = trs[j].querySelectorAll('td,th');
        if (!tds.length) continue;
        out.push({ k: txt(tds[0]), v: txt(tds[tds.length-1]), n: tds.length,
                   all: Array.prototype.map.call(tds, function(c){ return txt(c); }) });
      }
    }
    return out;
  }
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    kpiCost: byId('kpiCostVal'), kpiShut: byId('kpiShutVal'),
    kpiProfit: byId('kpiProfitVal'), kpiPay: byId('kpiPayVal'),
    vsRatio: byId('vsRatio'), vsMining: byId('vsMining'), vsSpot: byId('vsSpot'),
    pb18: byId('pb18Val'), pb24: byId('pb24Val'), pb48: byId('pb48Val'),
    econRows: rows('econRows'),
    mdetRows: grid('mdetBody'),
    /* Chart 1's panel hint is the one static label still carrying the "{n}"
       horizon token, so it is where the token has to be shown filled with this
       machine's own life span — not left as a placeholder and not dropped. */
    ch1Hint: (function () {
      var b = document.getElementById('chartPrice');
      var sec = b ? b.closest('section') : null;
      var el = sec ? sec.querySelector('.hint') : null;
      return txt(el);
    })(),
    lifeYears: (function () {
      var el = document.querySelector('[data-k="lifeYears"]');
      var y = el ? parseFloat(el.value) : NaN;
      return isFinite(y) ? y : null;
    })(),
    /* Which column of the input form the rack date lives in. Nothing numeric
       moves if it drifts back into the hardware spec sheet, so the placement
       itself has to be read out of the DOM — "first row of Operation" is a
       requirement, not a styling coincidence. */
    rackHome: (function () {
      var el = document.getElementById('rackDate');
      if (!el) return null;
      var grp = el.closest('.in-group');
      if (!grp) return null;
      var head = grp.querySelector('h3 span[data-i18n]');
      var fields = grp.querySelectorAll('.field');
      return {
        group: head ? head.getAttribute('data-i18n') : null,
        isFirst: fields.length > 0 && fields[0].contains(el),
        fields: fields.length
      };
    })(),
    /* What the input bar actually opens at. The three shipped values below are
       a product decision (95% uptime, 20% price growth, a power price quoted to
       the third decimal), so they are read off the rendered fields — a default
       changed in the model but not on screen, or shown with the wrong number of
       decimals, is exactly the kind of split no numeric assertion sees. */
    fieldDefaults: (function () {
      var out = {};
      ['uptime', 'btcGrowthAnnual', 'electricityPrice'].forEach(function (k) {
        var el = document.querySelector('[data-k="' + k + '"]');
        out[k] = el ? el.value : null;
      });
      var e = document.querySelector('[data-k="electricityPrice"]');
      out.elecStep = e ? e.getAttribute('step') : null;
      return out;
    })(),
    /* Every chart names its own region, and the panel heading names the same
       thing to a sighted reader, so on a one-chart panel the two must be the
       same string. Container is .panel, not section: charts 2/3 and 6/7 sit
       inside an inner panel (charts 2/3 in a two-column section, 6/7 sharing
       one panel), so the nearest section is the wrong heading.
       The heading is read with textContent, NOT innerText: .panel-hd h2 is
       text-transform: uppercase, so innerText would report "COST BREAKDOWN"
       and turn a case-only difference into a fake failure.
       NOTE: any backslash in this injected script must be doubled - the whole
       block is a template literal, so an unescaped /\\s+/ reaches the browser
       as /s+/ and silently eats every letter s. */
    chartTitles: (function () {
      /* Which title key each chart must carry. This IS the specification: a
         chart that starts announcing another chart's name fails here. */
      var KEYS = {
        chartPrice: 'ch1.title', chartCost: 'ch2.title', chartHash: 'ch3.title',
        chartBreak: 'ch4.title', chartSens: 'ch6.title',
        chartElec: 'ch7.title'
      };
      var out = [];
      Array.prototype.forEach.call(document.querySelectorAll('.chartbox'), function (box) {
        var svg = box.querySelector('svg[role="img"]');
        var pan = box.closest('.panel') || box.closest('section');
        var h2 = pan ? pan.querySelector('h2') : null;
        var key = KEYS[box.id] || null;
        out.push({
          id: box.id,
          key: key,
          want: (key && window.I18N) ? window.I18N.t(key) : null,
          aria: svg ? (svg.getAttribute('aria-label') || '') : null,
          head: h2 ? (h2.textContent || '').trim() : null,
          inPanel: pan ? pan.querySelectorAll('.chartbox').length : 0
        });
      });
      return out;
    })(),
    /* Chart 6 draws one line per BTC-growth rung, so both the line count and
       the palette width are set by the sensitivity ladder. Read them off the
       page instead of asserting a number: the chart and the matrix beside it are
       two views of one ladder, and this is the only place that ties them
       together. path[stroke] is exactly the series — the frame emits only
       <svg>/<clipPath> and every gridline is a <line>. */
    sensSeries: (function () {
      var svg = document.getElementById('chartSens');
      svg = svg && svg.querySelector('svg');
      var head = document.getElementById('heat');
      var rungs = head ? head.querySelectorAll('tr').length - 1 : null;
      if (!svg) return { strokes: null, rungs: rungs, palette: null, endLabels: null };
      /* Raw token text, not a resolved rgb(): the SVG carries what the token
         reader returned, so comparing against a re-serialised colour would only
         be measuring Chrome's colour formatter. */
      function tokenText(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      }
      return {
        strokes: Array.prototype.map.call(svg.querySelectorAll('path[stroke]'), function (p) {
          return p.getAttribute('stroke');
        }),
        rungs: rungs,
        palette: ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'].map(tokenText),
        endLabels: Array.prototype.map.call(svg.querySelectorAll('text'), function (t) {
          return txt(t);
        }).filter(function (t) { return / BTC$/.test(t); })
      };
    })(),
    /* Read the header cells directly. The body-text search cannot be used
       here: table headers are text-transform: uppercase and innerText reflects
       that, plus several of these words also appear elsewhere on the page —
       which makes a body-text search pass whether or not the table exists. */
    mdetHead: (function () {
      var tb = document.getElementById('mdetHead');
      if (!tb) return [];
      var ths = tb.querySelectorAll('th');
      return Array.prototype.map.call(ths, function (c) { return txt(c); });
    })(),
    /* The formula tooltip is bound to ONE header by index, which is exactly the
       kind of binding a column reorder desyncs in silence — the tooltip would
       keep rendering, just on the wrong column. */
    mdetTitles: (function () {
      var tb = document.getElementById('mdetHead');
      if (!tb) return [];
      var ths = tb.querySelectorAll('th');
      return Array.prototype.map.call(ths, function (c) { return c.getAttribute('title') || ''; });
    })(),
    mdetHoldHint: window.I18N ? window.I18N.t('mdet.holdCostHint') : null,
    elecRows: rows('elecRows'),
    /* The .scn-row rules are named after the scenario panel, which no longer
       exists — but the miner-parameter and data-source panels still build their
       lists from that class. Pin the layout they depend on, so a future
       "clean up the dead scenario CSS" pass cannot silently flatten them. */
    kvRow: (function () {
      var list = document.querySelectorAll('#econVol .scn-row');
      if (!list.length) return null;
      var cs = getComputedStyle(list[0]);
      return { n: list.length, display: cs.display, justify: cs.justifyContent };
    })(),
    tables: allTables(),
    bodyText: (document.body.innerText||'').replace(/\\s+/g,' ')
  };
})()`;

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const chrome = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
  ].find(p => fs.existsSync(p)) || 'chrome';

  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=0',
    '--window-size=1440,1100', '--user-data-dir=' + path.join(ROOT, 'qa', '.chrome-ind'),
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('no devtools')), 20000);
    proc.stderr.on('data', d => {
      buf += d.toString();
      const m = buf.match(/ws:\/\/[^\s]+/);
      if (m) { clearTimeout(t); resolve(m[0]); }
    });
  });

  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  const { targetId } = await cdp(ws, 'Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: true });
  await cdp(ws, 'Page.enable', {}, sessionId);
  await cdp(ws, 'Runtime.enable', {}, sessionId);
  await cdp(ws, 'Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?lang=en' }, sessionId);
  await new Promise(r => setTimeout(r, 3000));
  await cdp(ws, 'Runtime.evaluate', {
    expression: `try{localStorage.setItem('bmcm-theme','${THEME}');}catch(e){}; location.reload();`
  }, sessionId);
  await new Promise(r => setTimeout(r, 3000));

  const evalExpr = async (expr) => {
    const { result } = await cdp(ws, 'Runtime.evaluate', {
      expression: expr, returnByValue: true
    }, sessionId);
    return result.value;
  };

  const v = await evalExpr(PROBE);

  const NUMRE = /-?[\d,]+(\.\d+)?/;
  const BADRE = /NaN|Infinity|undefined|∞/i;

  h('core KPI presence (§03 / §09 / §53)');
  ok('Mining Cost / BTC is on the page', v.kpiCost && NUMRE.test(v.kpiCost), v.kpiCost);
  ok('Shutdown BTC Price is on the page', v.kpiShut && NUMRE.test(v.kpiShut), v.kpiShut);
  ok('Daily Net Profit is on the page', v.kpiProfit && NUMRE.test(v.kpiProfit), v.kpiProfit);
  ok('Static Payback is on the page', v.kpiPay != null && v.kpiPay.length > 0, v.kpiPay);

  h('no NaN / Infinity anywhere (§52)');
  const allVals = [v.kpiCost, v.kpiShut, v.kpiProfit, v.kpiPay, v.vsRatio, v.vsMining, v.vsSpot]
    .concat(v.econRows.map(r => r.v))
    .concat(v.mdetRows.flatMap(r => r.cells))
    .concat(v.elecRows.map(r => r.v));
  const bad = allVals.filter(x => x && BADRE.test(x));
  ok('no NaN/Infinity/undefined in rendered values', bad.length === 0, bad.slice(0, 6));

  h('input form layout (§ inputs)');
  ok('rack date sits in the Operation group, not Hardware',
    !!(v.rackHome && v.rackHome.group === 'inp.ops'), v.rackHome);
  ok('rack date is the first row of the Operation group',
    !!(v.rackHome && v.rackHome.isFirst), v.rackHome);

  h('shipped input defaults');
  ok('uptime opens at 95 %', v.fieldDefaults.uptime === '95', v.fieldDefaults);
  ok('BTC price growth opens at 20 %/yr', v.fieldDefaults.btcGrowthAnnual === '20', v.fieldDefaults);
  /* Three decimals, and the third one shown even when it is a zero: "$0.06" and
     "$0.060" are the same number but only one of them says "this field is
     quoted to a tenth of a cent". */
  ok('electricity price opens as a three-decimal value', v.fieldDefaults.electricityPrice === '0.060',
    v.fieldDefaults);
  ok('electricity price spins in tenths of a cent', v.fieldDefaults.elecStep === '0.001', v.fieldDefaults);

  h('mining economics panel (§10–§15)');
  ok('econ table has rows', v.econRows.length >= 6, v.econRows.length);
  /* Both cost bases must be on show: the all-in line, the depreciation that
     makes it all-in, and the operating cash flow the shutdown price compares
     against. Dropping any of them is how "$0.00 /day" happened. */
  ['Miner BTC / Day', 'Daily Electricity', 'Machine Depreciation / Day',
    'Daily Total Cost (all-in)', 'Daily Operating Cash Flow', 'Daily Revenue'].forEach(k => {
    const row = v.econRows.find(r => r.k === k);
    ok('econ row present: ' + k, !!row && NUMRE.test(row.v), row ? row.v : 'MISSING');
  });
  {
    const dep = v.econRows.find(r => r.k === 'Machine Depreciation / Day');
    const cash = v.econRows.find(r => r.k === 'Daily Operating Cash Flow');
    ok('depreciation row is not a bare zero',
      !!dep && parseFloat(String(dep.v).replace(/[^0-9.]/g, '')) > 0, dep ? dep.v : 'MISSING');
    ok('cash-flow row is not a bare zero',
      !!cash && parseFloat(String(cash.v).replace(/[^0-9.]/g, '')) > 0, cash ? cash.v : 'MISSING');
  }

  h('payback price ladder (§20)');
  const pbVals = { '18M': v.pb18, '24M': v.pb24, '48M': v.pb48 };
  Object.keys(pbVals).forEach(k => {
    ok(k + ' payback BTC price rendered', pbVals[k] && NUMRE.test(pbVals[k]), pbVals[k]);
  });

  /* The annual/monthly projection panel that used to be asserted here was
     removed on request — the monthly detail table below reports the same
     quantities at a finer grain, so nothing replaced it and nothing is
     asserted about it. */

  h('monthly cost detail (§18, calendar-anchored)');
  {
    /* Ten named columns, one line per billing period, 期数 numbering the
       periods (not the months), and the halving month arriving as two lines
       instead of one averaged line. Every column is looked up by NAME, never
       by a hardcoded index: adding a column is exactly the change that would
       otherwise shift every assertion silently onto its neighbour. */
    const want = ['Period no.', 'Dates', 'Implied network hashrate', 'Block subsidy',
      'BTC / TH / day', 'BTC produced', 'Electricity', 'All-in monthly cost',
      'All-in cost basis', 'Shutdown price'];
    ok('detail table has ten columns', v.mdetHead.length === 10, v.mdetHead.length);
    want.forEach((k, i) => {
      ok('detail column ' + (i + 1) + ' is "' + k + '"',
        String(v.mdetHead[i] || '').toLowerCase() === k.toLowerCase(), v.mdetHead[i]);
    });
    const C = {};
    v.mdetHead.forEach((h, i) => { C[String(h).toLowerCase()] = i; });
    const col = (name) => C[name.toLowerCase()];
    ok('every column can be looked up by name',
      want.every(k => col(k) !== undefined), want.filter(k => col(k) === undefined));

    /* Dropped on request. Pinned as an explicit absence so re-adding it is a
       decision someone has to argue with, not a silent drift — the length
       check above would catch it, but this states WHY. */
    ok('the cost-share column is gone for good',
      col('Cost share of revenue') === undefined
      && !/cost\s*share/i.test(v.bodyText),
      'still present in headers or body');

    /* Three placements are a product decision, so they are pinned by POSITION
       and not just by their presence in the name list above: the shutdown
       price closes the row, the electricity bill sits right before the all-in
       cost it is one component of, and production sits right after the rate
       that produces it. A future reshuffle has to argue with these three. */
    ok('shutdown price is the LAST column',
      col('Shutdown price') === v.mdetHead.length - 1, col('Shutdown price'));
    ok('electricity sits immediately before all-in monthly cost',
      col('Electricity') + 1 === col('All-in monthly cost'),
      col('Electricity') + ' -> ' + col('All-in monthly cost'));
    ok('BTC produced sits immediately after BTC / TH / day',
      col('BTC produced') === col('BTC / TH / day') + 1,
      col('BTC / TH / day') + ' -> ' + col('BTC produced'));

    /* The formula tooltip follows its column, not a stale index. */
    const titled = (v.mdetTitles || []).map((t, i) => (t ? i : -1)).filter(i => i >= 0);
    ok('exactly one detail header carries a formula tooltip', titled.length === 1, titled.join('/'));
    ok('  ... and it is on the all-in cost basis column, not a stray neighbour',
      titled[0] === col('All-in cost basis'), titled[0] + ' vs ' + col('All-in cost basis'));
    ok('  ... and it spells out the division',
      /÷|BTC/.test(v.mdetTitles[col('All-in cost basis')] || ''),
      v.mdetTitles[col('All-in cost basis')]);
    /* The DOM-side companion to the cross-locale check in test_i18n.js. Note
       this probe pins ?lang=en, so on its own it only ever proves the ENGLISH
       tooltip still matches the ENGLISH header — the all-locale coverage
       lives in test_i18n.js. Keep both: this one proves the value actually
       reaches the rendered DOM, that one proves every locale stays coherent. */
    ok('  ... and it cites the production column by its current label',
      (v.mdetTitles[col('All-in cost basis')] || '')
        .indexOf(v.mdetHead[col('BTC produced')]) >= 0,
      JSON.stringify([v.mdetTitles[col('All-in cost basis')],
        v.mdetHead[col('BTC produced')]]));
    ok('  ... matching the hint string the locale ships',
      v.mdetTitles[col('All-in cost basis')] === v.mdetHoldHint,
      JSON.stringify([v.mdetTitles[col('All-in cost basis')], v.mdetHoldHint]));

    const money = (s) => Number(String(s).replace(/[^0-9.]/g, ''));
    const parse = (r) => {
      const dates = r.cells[col('Dates')].match(/\d{4}-\d{2}-\d{2}/g) || [];
      return { start: dates[0], end: dates[1], days: r.days };
    };
    const lines = v.mdetRows.filter(r => !r.total).map(r => Object.assign(parse(r), { r }));
    const splits = lines.filter(x => x.r.split);
    const monthLines = lines.filter(x => !x.r.split);

    /* 48 billing months; the halving month is split, so 49 periods in total. */
    ok('48 detail lines for a 4-year life, plus 1 for the split',
      lines.length === 49, lines.length);
    ok('exactly one month is split in two', splits.length === 2, splits.length);
    ok('every line has ten cells',
      v.mdetRows.every(r => r.cells.length === 10),
      Array.from(new Set(v.mdetRows.map(r => r.cells.length))).join('/'));

    /* 期数: 1..49, one per line, no repeats, and the split pair consecutive. */
    const numbers = lines.map(x => x.r.cells[col('Period no.')]);
    ok('期数 is a plain integer on every line',
      numbers.every(n => /^\d+$/.test(n)), numbers.filter(n => !/^\d+$/.test(n)).slice(0, 3));
    ok('期数 counts the periods 1..49 down the table',
      numbers.join(',') === lines.map((x, i) => i + 1).join(','), numbers.slice(0, 4).join(','));
    ok('no two lines share a 期数',
      new Set(numbers).size === numbers.length,
      numbers.length - new Set(numbers).size);
    ok('the split month takes two consecutive 期数',
      Number(numbers[lines.indexOf(splits[1])]) - Number(numbers[lines.indexOf(splits[0])]) === 1,
      splits.map(x => x.r.cells[col('Period no.')]).join('|'));

    /* Real calendar months: 28–31 days, and the 48 months add up to the
       calendar span of 4 years from the rack date — 1461 days, not 1440. */
    ok('unsplit month lengths are 28–31',
      monthLines.every(x => x.days >= 28 && x.days <= 31),
      Array.from(new Set(monthLines.map(x => x.days))).sort((a, b) => a - b).join('/'));
    ok('a February is present among the month lengths', monthLines.some(x => x.days === 28),
      Array.from(new Set(monthLines.map(x => x.days))).sort((a, b) => a - b).join('/'));
    ok('all 48 months cover 1461 days (4 years, not 1440)',
      lines.reduce((a, x) => a + x.days, 0) === 1461,
      lines.reduce((a, x) => a + x.days, 0));
    ok('the split parts add up to a normal month length',
      splits.reduce((a, x) => a + x.days, 0) >= 28 && splits.reduce((a, x) => a + x.days, 0) <= 31,
      splits.reduce((a, x) => a + x.days, 0));

    ok('every line starts and ends on a real ISO date',
      lines.every(x => /^\d{4}-\d{2}-\d{2}$/.test(x.start) && /^\d{4}-\d{2}-\d{2}$/.test(x.end)),
      lines.filter(x => !x.start || !x.end).length);
    ok('periods are contiguous (next start = previous end + 1 day)',
      lines.every((x, i) => {
        if (i === 0) return true;
        const prevEnd = new Date(lines[i - 1].end + 'T00:00:00Z').getTime();
        const curStart = new Date(x.start + 'T00:00:00Z').getTime();
        return curStart - prevEnd === 86400000;
      }),
      lines.map((x, i) => i === 0 ? null
        : Math.round((new Date(x.start + 'T00:00:00Z') - new Date(lines[i - 1].end + 'T00:00:00Z')) / 86400000))
        .filter(g => g !== null && g !== 1).slice(0, 3));

    ok('split lines are labelled pre- and post-halving',
      splits.length === 2
      && /pre-halving/i.test(splits[0].r.cells[col('Dates')])
      && /post-halving/i.test(splits[1].r.cells[col('Dates')]),
      splits.map(x => x.r.cells[col('Dates')]).join(' | '));
    ok('split lines carry the two subsidies (3.125 / 1.5625)',
      splits.map(x => x.r.cells[col('Block subsidy')].trim()).join('|') === '3.1250|1.5625',
      splits.map(x => x.r.cells[col('Block subsidy')]).join('|'));
    ok('the pre-halving line bills fewer days than the post-halving one',
      splits[0].days < splits[1].days, splits.map(x => x.days).join('/'));

    /* 综合持仓成本 — rendered as money, cheaper before the halving than after
       (same cost per day, twice the coins), and the column's footer equal to
       the footer's own 综合成本 ÷ 产量. */
    const basis = lines.map(x => x.r.cells[col('All-in cost basis')]);
    ok('every line carries a money cost basis',
      basis.every(s => /^\$[\d,]+/.test(s)), basis.filter(s => !/^\$[\d,]+/.test(s)).slice(0, 3));
    ok('the pre-halving period holds coins cheaper than the post-halving one',
      money(basis[lines.indexOf(splits[0])]) < money(basis[lines.indexOf(splits[1])]),
      splits.map(x => x.r.cells[col('All-in cost basis')]).join(' vs '));
    {
      const t = v.mdetRows.filter(r => r.total)[0];
      const cost = money(t.cells[col('All-in monthly cost')]);
      const btc = money(t.cells[col('BTC produced')]);
      const got = money(t.cells[col('All-in cost basis')]);
      /* Loose on purpose: the cells on the page are rounded for display, so
         the ratio of the rendered figures cannot be exact — but a wrong
         formula (per month instead of cumulative, or over revenue) misses by
         tens of percent. */
      ok('footer 持仓成本 = footer 综合成本 ÷ footer 产量 (±0.5%)',
        Math.abs(got - cost / btc) / got < 0.005, { got, cost, btc, want: cost / btc });
    }

    ok('detail table has exactly one total row', v.mdetRows.filter(r => r.total).length === 1);
    ok('total row carries ten cells',
      v.mdetRows.filter(r => r.total).every(r => r.cells.length === 10));
    ok('total row reports the full 1461-day span',
      /1461/.test(v.mdetRows.filter(r => r.total)[0].cells[col('Dates')]),
      v.mdetRows.filter(r => r.total)[0].cells[col('Dates')]);
    ok('total row counts the 49 periods',
      /49/.test(v.mdetRows.filter(r => r.total)[0].cells[col('Period no.')]),
      v.mdetRows.filter(r => r.total)[0].cells[col('Period no.')]);
    ok('no NaN/Infinity/undefined/null in the detail cells',
      v.mdetRows.every(r => r.cells.every(c => !/NaN|Infinity|undefined|null|\[object/i.test(c))),
      v.mdetRows.flatMap(r => r.cells)
        .filter(c => /NaN|Infinity|undefined|null|\[object/i.test(c)).slice(0, 5));
    ok('every line carries a positive production figure',
      lines.every(x => /[1-9]/.test(x.r.cells[col('BTC produced')])),
      lines.map(x => x.r.cells[col('BTC produced')]).filter(c => !/[1-9]/.test(c)).slice(0, 3));
    /* Removing the cost-share column made this pair adjacent, so the new
       adjacency gets its own guard rather than relying on the name list. */
    ok('the cost basis now sits immediately before the shutdown price',
      col('All-in cost basis') + 1 === col('Shutdown price'),
      col('All-in cost basis') + ' -> ' + col('Shutdown price'));
    /* It was the only column rendered as a percentage. Deleting one <td> from
       the row template is exactly how a value silently slides into its
       neighbour's column, so assert the whole table is now percentage-free. */
    ok('no cell in the detail table is a percentage any more',
      v.mdetRows.every(r => r.cells.every(c => !/%/.test(c))),
      v.mdetRows.flatMap(r => r.cells).filter(c => /%/.test(c)).slice(0, 5));
  }

  h('locale plumbing (§47)');
  {
    /* A "{n}" pattern that never got filled is invisible to the untranslated
       audit — it contains no ASCII word long enough to flag — so it needs its
       own guard. The horizon token is filled by relabelDom at paint time. */
    const i = v.bodyText.indexOf('{n}');
    ok('no literal {n} placeholder left on the page', i < 0,
      i < 0 ? '' : v.bodyText.slice(Math.max(0, i - 70), i + 24));
    /* …and the token has to land on the model's OWN life span. The removed
       projection panel hard-coded a four-year horizon in its title, and the
       chart-1 hint once quoted months while being handed years — both read
       perfectly and were both wrong. Assert the number, not the phrasing. */
    ok('the {n} horizon token is filled with the model life span',
      v.lifeYears !== null && v.ch1Hint !== null &&
      new RegExp('\\b' + v.lifeYears + '\\b').test(v.ch1Hint),
      { hint: v.ch1Hint, lifeYears: v.lifeYears });
  }

  h('Mining vs Buy & Hold (§28–§32)');
  ok('Mining/Spot ratio rendered', v.vsRatio && /%/.test(v.vsRatio), v.vsRatio);
  ok('Mining BTC rendered', v.vsMining && NUMRE.test(v.vsMining), v.vsMining);
  ok('Buy & Hold BTC rendered', v.vsSpot && NUMRE.test(v.vsSpot), v.vsSpot);
  ok('no subjective "is better" wording (§28)',
    !/\b(is|are)\s+better\b|\bsuperior\b|\brecommend/i.test(v.bodyText),
    (v.bodyText.match(/\b(is|are)\s+better\b|\bsuperior\b|\brecommend/i) || [])[0] || 'clean');

  h('shared key/value rows (survived the scenario-panel removal)');
  ok('miner-parameter list still renders in the .scn-row flex layout',
    v.kvRow && v.kvRow.n === 6 && v.kvRow.display === 'flex' && v.kvRow.justify === 'space-between',
    v.kvRow);

  h('sensitivity (§34 / §35)');
  ok('electricity sensitivity rows present', v.elecRows.length >= 5, v.elecRows.length);
  ok('electricity grid covers $0.03–$0.10', v.elecRows.length > 0 &&
    v.elecRows.some(r => /0\.03/.test(r.k)) && v.elecRows.some(r => /0\.10/.test(r.k)),
    v.elecRows.map(r => r.k).slice(0, 8));

  h('chart accessible names');
  ok('all six chart panels were found', v.chartTitles.length === 6, v.chartTitles.length);
  const unknownChart = v.chartTitles.filter(c => !c.key).map(c => c.id);
  ok('every chartbox is a chart with a known title key', unknownChart.length === 0, unknownChart);
  const nameBad = v.chartTitles.filter(c => !c.aria || c.want === null || c.aria !== c.want);
  ok('each chart announces the title its own key holds', nameBad.length === 0, nameBad);
  /* A panel holding exactly one chart gives that chart its heading, so the
     visible title and the spoken one cannot drift apart. */
  const soloBad = v.chartTitles.filter(c => c.inPanel === 1 && c.head !== c.aria);
  ok('a lone chart is announced with its own panel heading', soloBad.length === 0, soloBad);
  /* The shared panel hands its heading to neither chart, so their names have
     to stay distinct rather than both collapsing onto the panel title. */
  const duo = v.chartTitles.filter(c => c.inPanel > 1);
  ok('charts sharing one panel keep distinct names',
    duo.length === 2 && duo[0].aria !== duo[1].aria, duo);

  h('charts rendered (§24–§27)');
  const chartCount = await evalExpr(
    `document.querySelectorAll('.chartbox svg').length`);
  ok('6 charts present (includes sensitivity + elec)', chartCount === 6, chartCount);

  h('sensitivity chart palette covers the ladder (§34)');
  const ss = v.sensSeries;
  /* Six rungs on the ladder, six lines on the chart, six colours in the
     palette. A wrapped palette (four colours, `i % 4`) draws rung 0 and rung 4
     in the same blue — indistinguishable at a glance and invisible to every
     other check on this page. */
  ok('chart 6 draws one line per BTC rung', ss.strokes.length === ss.rungs,
    { lines: ss.strokes.length, rungs: ss.rungs });
  ok('no two rungs share a colour',
    new Set(ss.strokes).size === ss.strokes.length, ss.strokes);
  ok('each line takes the next chart token, in rung order',
    ss.strokes.every((s, i) => s === ss.palette[i]),
    { strokes: ss.strokes, palette: ss.palette });
  ok('every rung is named at its line end',
    ss.endLabels.length === ss.rungs, ss.endLabels);

  h('formula drawer (§47)');
  ok('formulas list present', /BTC\/TH\/day|Shutdown price/i.test(
    (await evalExpr(`(document.getElementById('formulas')||{}).textContent||''`)) || ''),
    'check #formulas');

  h('model assumptions (§48)');
  const asm = await evalExpr(`(document.getElementById('assumptions')||{}).textContent||''`);
  ok('assumptions block populated', asm && asm.length > 200, (asm || '').length);
  ok('assumptions disclaims investment advice', /not investment advice/i.test(asm || ''), '');
  ok('assumptions avoid hardcoded halving date (§17)',
    !/20(2[4-9]|3\\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])/.test(asm || ''),
    'no ISO date found');

  h('machine-payback tag (§14 on the rendered table)');
  {
    /* The tag is a UI rendering of summary.paybackMonth. The engine test pins
       the crossing; this one pins that the renderer wires it — present exactly
       when the model names a month, absent when it doesn't. The default machine
       never recovers its capex on the simulated curve, so the absence is itself
       the assertion; a cheap machine makes the tag appear. */
    const readPay = `(function(){
      var r = window.__model && window.__model.read();
      var pm = (r && r.summary) ? r.summary.paybackMonth : null;
      var head = [].slice.call(document.querySelectorAll('#mdetHead th')).map(function(th){ return (th.textContent||'').trim(); });
      var ci = head.indexOf('Dates');
      var starts = [];
      [].slice.call(document.querySelectorAll('#mdetBody tr')).forEach(function(tr){
        if (/total/.test(String(tr.className))) return;
        var td = tr.children[ci]; if (!td) return;
        if (td.querySelector('.mtag.pay')) {
          var m = (td.textContent||'').match(/[0-9]{4}-[0-9]{2}-[0-9]{2}/);
          if (m) starts.push(m[0]);
        }
      });
      var want = (pm && r.rows[pm-1]) ? r.rows[pm-1].dateStart : null;
      return { pm: pm, tagged: starts.length, want: want, got: starts };
    })()`;

    const dflt = await evalExpr(readPay);
    ok('shipped config has no payback month and renders no tag',
      dflt.pm === null && dflt.tagged === 0, dflt);

    await evalExpr(`window.__model.set('machinePrice', 1000); true`);
    const cheap = await evalExpr(readPay);
    ok('a cheap machine names a payback month', Number.isInteger(cheap.pm) && cheap.pm >= 1, cheap.pm);
    ok('  ... and exactly one payback tag renders on it', cheap.tagged === 1, cheap.tagged);
    ok('  ... on the month the model names', cheap.got[0] === cheap.want,
      { got: cheap.got, want: cheap.want });
  }

  h('miner picker drives the model (the catalogue is reachable)');
  {
    /* The miner <select> is the one control input_reactivity.js never reached
       (it walks `input[data-k]`, and a <select> is not one). Pinning it here
       closes the "dead control" hole: picking a model must fill the three
       numeric fields, not just move the label. */
    const pick = await evalExpr(`(function(){
      var sel = document.querySelector('select[data-k="minerKey"]');
      if (!sel) return { error: 'no select' };
      sel.value = 's23-hyd';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      var h = document.querySelector('input[data-k="hashrate"]');
      var p = document.querySelector('input[data-k="power"]');
      var mp = document.querySelector('input[data-k="machinePrice"]');
      return { hashrate: h ? h.value : null, power: p ? p.value : null, machinePrice: mp ? mp.value : null };
    })()`);
    ok('picking the hydro unit fills hashrate', pick.hashrate === '580', pick);
    ok('picking the hydro unit fills power', pick.power === '5510', pick);
    ok('picking the hydro unit fills machine price', pick.machinePrice === '14300', pick);
  }

  console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILED') + '  ' + pass + ' passed / ' + fail + ' failed');
  ws.close(); proc.kill(); server.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
