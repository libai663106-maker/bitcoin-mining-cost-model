/* Input reactivity (§55) — every result must recompute on any input change,
 * and each input must move the outputs in the economically correct direction.
 *
 * Usage: node scripts/input_reactivity.js
 */
const http = require('http'), path = require('path');
const { spawn } = require('child_process');

/* data.js is a browser module, but a bare fake window is enough to reach the
   shipped defaults (same trick as test_engine.js). The cases below are stated
   relative to those defaults rather than to a copy of them. */
global.window = global.window || {};
require('./data.js');
const D = global.window.AppData;

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.resolve(__dirname, '..');
/* Pinned to English so this suite asserts input→model behaviour, not whatever
   locale the shared Chrome profile happens to remember. */
const FILE = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') + '?lang=en';
const PORT = 9900 + Math.floor(Math.random() * 80);

const getJson = p => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
    let d = ''; r.on('data', c => d += c);
    r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on('error', rej);
});
const connect = url => new Promise((res, rej) => {
  const ws = new WebSocket(url); let id = 0; const w = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && w.has(m.id)) { const x = w.get(m.id); w.delete(m.id); m.error ? x.reject(new Error(JSON.stringify(m.error))) : x.resolve(m.result); }
  });
  ws.addEventListener('open', () => res({
    send: (method, params) => new Promise((resolve, reject) => { const i = ++id; w.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); }),
    close: () => ws.close()
  }));
  ws.addEventListener('error', rej);
});

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };

(async () => {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(ROOT, 'qa', 'profile-ir'),
    '--window-size=1440,1000', FILE
  ], { stdio: 'ignore' });

  let cdp;
  for (let i = 0; i < 60; i++) { try { cdp = await connect((await getJson('/json/list')).find(t => t.type === 'page').webSocketDebuggerUrl); break; } catch (e) { await new Promise(r => setTimeout(r, 250)); } }
  if (!cdp) { chrome.kill(); throw new Error('no attach'); }

  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: FILE });
  await new Promise(r => setTimeout(r, 3200));

  const ev = async e => {
    const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception || {}).description);
    return r.result.value;
  };

  const read = () => ev(`(function(){
    function t(id){ var el=document.getElementById(id); return el? el.textContent.trim() : null; }
    var num=function(s){ if(!s) return null; var m=String(s).replace(/[$,%\\s]/g,'').match(/-?[\\d.]+([kKmM])?/); if(!m) return null;
      var v=parseFloat(m[0]); var u=m[1]; if(u==='k'||u==='K') v*=1e3; if(u==='m'||u==='M') v*=1e6; return v; };
    var eco={};
    document.querySelectorAll('#econRows tr').forEach(function(tr){
      var k=tr.children[0], v=tr.children[1];
      if(k&&v) eco[k.textContent.trim()]=num(v.textContent);
    });
    var pb={};
    document.querySelectorAll('#payRows tr, #paybackRows tr').forEach(function(tr){
      var k=tr.children[0], v=tr.children[1];
      if(k&&v) pb[k.textContent.trim()]=num(v.textContent);
    });
    /* DOM-level proof that the monthly detail table re-rendered — not just that
       the model did. The BTC-produced column is summed straight out of the
       cells, looked up by header NAME: an index would silently move this
       reading onto its neighbour the next time a column is added. The total row
       is skipped because it is an aggregate of the rows above it. */
    var mdetBtc=(function(){
      var head=document.getElementById('mdetHead'), body=document.getElementById('mdetBody');
      if(!head||!body) return null;
      var ths=[].slice.call(head.querySelectorAll('th')), ci=-1;
      ths.forEach(function(th,i){ if(/btc\\s*produced/i.test(th.textContent)) ci=i; });
      if(ci<0) return null;
      var sum=0;
      [].slice.call(body.querySelectorAll('tr')).forEach(function(tr){
        if(/total/.test(String(tr.className))) return;
        var td=tr.children[ci]; if(!td) return;
        var v=num(td.textContent); if(v!==null) sum+=v;
      });
      return sum;
    })();
    /* raw model values the table does not surface directly */
    var r = (window.__model && window.__model.read) ? window.__model.read() : null;
    var yearPrices = r && r.years ? r.years.map(function(y){ return y.btcPriceEnd; }) : [];
    var yearBtc = r && r.years ? r.years.map(function(y){ return y.btc; }) : [];
    return {
      kpiCost: num(t('kpiCostVal')), kpiShut: num(t('kpiShutVal')),
      kpiProfit: num(t('kpiProfitVal')), kpiPay: num(t('kpiPayVal')),
      eco: eco, mdetBtc: mdetBtc, yearPrices: yearPrices, yearBtc: yearBtc,
      raw: { cost: t('kpiCostVal'), shut: t('kpiShutVal'), profit: t('kpiProfitVal'), pay: t('kpiPayVal') }
    };
  })()`);

  const setInput = async (k, v) => {
    /* drive the model directly — faster and deterministic vs. synthesising
       input+change events, and it exercises the same render path */
    const used = await ev(`(function(){
      if (window.__model && window.__model.set) { window.__model.set(${JSON.stringify(k)}, ${JSON.stringify(v)}); return 'model'; }
      var el = document.querySelector('[data-k="${k}"]'); if (!el) return false;
      el.value = ${JSON.stringify(String(v))};
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      return 'dom';
    })()`);
    await new Promise(r => setTimeout(r, 350));
    return used;
  };
  const resetInputs = async () => {
    await ev(`window.__model && window.__model.resetToLive && window.__model.resetToLive()`);
    await new Promise(r => setTimeout(r, 350));
  };

  const defaults = await read();
  ok('default KPI set renders numbers', ['kpiCost','kpiShut','kpiProfit','kpiPay'].every(k => typeof defaults[k] === 'number'), defaults.raw);

  /* regress guard: resetToLive must actually restore defaults, otherwise the
     cases below contaminate each other (this bit us once) */
  await setInput('electricityPrice', 0.12);
  await resetInputs();
  const afterReset = await read();
  ok('resetToLive restores defaults', afterReset.kpiCost === defaults.kpiCost,
    { reset: afterReset.raw, def: defaults.raw });

  /* ---- each input must move the model, in the right direction ---- */
  const cases = [
    { k: 'electricityPrice', v: 0.09, name: 'electricity price ↑', check: (b, a) => a.kpiCost > b.kpiCost && a.kpiShut > b.kpiShut, note: 'cost/BTC and shutdown price must rise' },
    { k: 'electricityPrice', v: 0.03, name: 'electricity price ↓', check: (b, a) => a.kpiCost < b.kpiCost && a.kpiShut < b.kpiShut, note: 'both must fall' },
    /* power draw is tied to the machine model, not to TH/s — a lower-hashrate
       miner of the same wattage earns less BTC at the same electricity cost. */
    { k: 'hashrate', v: 200, name: 'miner hashrate ↓', check: (b, a) => a.eco['Miner BTC / Day'] < b.eco['Miner BTC / Day'], note: 'less TH/s at the same wattage → less BTC produced' },
    { k: 'power', v: 5000, name: 'power draw ↑', check: (b, a) => a.eco['Daily Electricity'] > b.eco['Daily Electricity'] && a.kpiCost > b.kpiCost, note: 'daily electricity and cost/BTC must rise' },
    { k: 'machinePrice', v: 15000, name: 'machine price ↑', check: (b, a) => a.kpiCost > b.kpiCost, note: 'capex lifts cost/BTC' },
    { k: 'machinePrice', v: 3000, name: 'machine price ↓', check: (b, a) => a.kpiCost < b.kpiCost, note: 'cost/BTC must fall' },
    { k: 'btcPrice', v: 200000, name: 'BTC price ↑', check: (b, a) => a.eco['Daily Revenue'] > b.eco['Daily Revenue'] && a.kpiCost === b.kpiCost, note: 'revenue rises, cost/BTC unchanged (denominated in BTC)' },
    /* uptime is stored as a 0–1 fraction (PCT_KEYS renders it as %) */
    { k: 'uptime', v: 0.70, name: 'uptime ↓', check: (b, a) => a.eco['Daily Electricity'] < b.eco['Daily Electricity'] && a.eco['Miner BTC / Day'] < b.eco['Miner BTC / Day'], note: 'less runtime → less power and less BTC' },
    { k: 'poolFee', v: 0.05, name: 'pool fee ↑', check: (b, a) => a.eco['Miner BTC / Day'] < b.eco['Miner BTC / Day'], note: 'credited BTC must fall' },
    { k: 'hashrateGrowthAnnual', v: 0.25, name: 'hashrate growth ↑', check: (b, a) => a.mdetBtc < b.mdetBtc && a.yearBtc[3] < b.yearBtc[3], note: 'faster network growth → less BTC over the horizon and in year 4' },
    /* cost/BTC and shutdown price are both BTC-denominated, so a BTC price path
       change moves the projected BTC price, not the shutdown threshold. The
       probe value is stated *above the shipped default*: it used to be the
       literal 0.20, which silently became a before === after no-op the day the
       default moved from 5% to 20%. */
    { k: 'btcGrowthAnnual', v: D.DEFAULTS.btcGrowthAnnual + 0.15, name: 'BTC growth ↑', check: (b, a) => a.yearPrices[3] > b.yearPrices[3] || a.yearBtc[3] > b.yearBtc[3], note: 'the modelled BTC price path must steepen' }
  ];

  /* A case whose target value IS the shipped default proves nothing: setting an
     input to the value it already holds leaves before === after, and the case
     goes green-looking-red-free forever. Derive the check from the defaults so
     the next default move cannot hide a case. */
  const noop = cases.filter(c => D.DEFAULTS[c.k] === c.v).map(c => c.k + ' = ' + c.v);
  ok('no reactivity case writes the value the input already has', noop.length === 0, noop);

  for (const c of cases) {
    const before = await read();
    const used = await setInput(c.k, c.v);
    if (!used) { ok('input exists: ' + c.k, false); continue; }
    const after = await read();
    ok(c.name + ' → recomputes (' + c.note + ')', c.check(before, after),
      { before: before.raw, after: after.raw, eco: after.eco });
    await resetInputs();
  }

  /* ---- changing one input must not leave another stale ---- */
  const b0 = await read();
  await setInput('electricityPrice', 0.10);
  const b1 = await read();
  const changed = ['kpiCost', 'kpiShut', 'kpiProfit', 'kpiPay'].filter(k => b0[k] !== b1[k]);
  ok('a single input change propagates to ≥3 KPI tiles', changed.length >= 3, changed);
  /* §52: KPI text must never contain NaN/Infinity/undefined — "No Payback",
     "N/A" and "-$x" are all legitimate states. */
  const bad = ['kpiCost','kpiShut','kpiProfit','kpiPay'].filter(k => /NaN|Infinity|undefined/.test(String(b1.raw[k] || '')));
  ok('no KPI shows NaN/Infinity/undefined after change', bad.length === 0, { bad: bad, raw: b1.raw });

  /* §52 + §14: when daily profit ≤ 0 the payback tile must read "No Payback",
     never a negative or infinite number. Force an unprofitable configuration. */
  await resetInputs();
  await setInput('electricityPrice', 0.30);
  await setInput('btcPrice', 1000);
  const loss = await read();
  ok('unprofitable config → static payback reads "No Payback"', loss.raw.pay === 'No Payback', loss.raw);
  ok('unprofitable config → KPI text stays finite/readable', !/NaN|Infinity|undefined/.test(loss.raw.pay + loss.raw.profit), loss.raw);
  await resetInputs();

  console.log('\n---------------------------------------');
  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  console.log('---------------------------------------');
  cdp.close(); chrome.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
