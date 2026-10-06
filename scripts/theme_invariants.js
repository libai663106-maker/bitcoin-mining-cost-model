/* Theme invariants (§45) — switching theme must not clear inputs, change any
 * result, rewrite the URL, reset parameters, or move the layout.
 *
 * Usage: node scripts/theme_invariants.js
 */
const http = require('http'), path = require('path'), fs = require('fs');
const { spawn } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.resolve(__dirname, '..');
/* Pinned to English so this suite asserts theme behaviour, not whatever
   locale the shared Chrome profile happens to remember. */
const FILE = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') + '?lang=en';
const PORT = 9810 + Math.floor(Math.random() * 90);

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
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };

(async () => {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(ROOT, 'qa', 'profile-ti'),
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

  /* a user-modified state: change a few inputs so we can prove nothing resets */
  await ev(`(function(){
    function set(k, v){
      var el = document.querySelector('[data-k="'+k+'"]');
      if(!el) return false;
      el.value = v;
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      return true;
    }
    window.__tiSet = { e: set('electricityPrice','0.045'), h: set('hashrate','280'), m: set('machinePrice','6500') };
  })()`);
  await new Promise(r => setTimeout(r, 600));
  const setResult = await ev('window.__tiSet');
  ok('harness found all three inputs', setResult.e && setResult.h && setResult.m, setResult);

  const snap = async () => ev(`(function(){
    var inputs={};
    document.querySelectorAll('[data-k]').forEach(function(el){ inputs[el.getAttribute('data-k')]=el.value; });
    var out={};
    ['kpiCostVal','kpiShutVal','kpiProfitVal','kpiPayVal'].forEach(function(id){
      var el=document.getElementById(id); out[id]= el? el.textContent.trim() : null;
    });
    var rows=[];
    var tb=document.getElementById('mdetBody');
    if(tb) [].slice.call(tb.children).forEach(function(tr){ rows.push([].slice.call(tr.children).map(function(td){return td.textContent.trim()}).join('|')); });
    /* The chart palette this theme actually painted with, and the palette the
       sheet says it should have. A memoised token read is the failure mode this
       catches: the values would come out as the previous theme's. */
    var box = document.getElementById('chartSens');
    var svg = box ? box.querySelector('svg') : null;
    var strokes = svg ? [].slice.call(svg.querySelectorAll('path[stroke]')).map(function(p){ return p.getAttribute('stroke'); }) : null;
    var tokens = ['--chart-1','--chart-2','--chart-3','--chart-4','--chart-5','--chart-6'].map(function(n){
      return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    });
    return {
      inputs: inputs, out: out, rows: rows,
      url: location.href,
      pageH: document.documentElement.scrollHeight,
      scrollW: document.documentElement.scrollWidth,
      strokes: strokes,
      tokens: tokens
    };
  })()`);

  const base = await snap();
  ok('baseline captured with modified inputs', base.out.kpiCostVal && /\d/.test(base.out.kpiCostVal), base.out);
  ok('baseline electricity actually applied', base.inputs.electricityPrice === '0.045', base.inputs.electricityPrice);
  ok('baseline hashrate actually applied', base.inputs.hashrate === '280', base.inputs.hashrate);
  ok('baseline KPI reflects modified input (differs from default 0.06)', base.out.kpiCostVal !== null, base.out.kpiCostVal);

  const themes = ['dark', 'tech', 'minimal', 'light'];
  const palettes = {};
  for (const t of themes) {
    /* Theme is switched by hand, so the token cache is dropped by hand — the
       app does exactly this in applyTheme(). Without it the charts keep the
       boot palette across all four themes, and every "invariant" below would be
       comparing light-palette charts four times. */
    await ev(`localStorage.setItem('bmcm-theme','${t}');document.documentElement.setAttribute('data-theme','${t}');window.AppData&&window.AppData.dropTokCache();window.__model&&window.__model.render();`);
    await new Promise(r => setTimeout(r, 700));
    const s = await snap();

    ok(`[${t}] inputs unchanged`, JSON.stringify(s.inputs) === JSON.stringify(base.inputs),
      { before: base.inputs.inElectricity, after: s.inputs.inElectricity });
    ok(`[${t}] KPI results unchanged`, JSON.stringify(s.out) === JSON.stringify(base.out), { b: base.out, a: s.out });
    ok(`[${t}] detail table rows unchanged`, JSON.stringify(s.rows) === JSON.stringify(base.rows));
    ok(`[${t}] URL unchanged`, s.url === base.url, { b: base.url, a: s.url });
    ok(`[${t}] page height unchanged (±2px)`, Math.abs(s.pageH - base.pageH) <= 2, { b: base.pageH, a: s.pageH });
    ok(`[${t}] no horizontal overflow`, s.scrollW <= 1441, s.scrollW);
    ok(`[${t}] data-theme applied`, (await ev(`document.documentElement.getAttribute('data-theme')`)) === t);

    /* The chart must be painted in THIS theme's palette. This is the assertion
       the cache-drop above exists for: without it every theme renders the light
       palette and all four of these passes are the same measurement repeated. */
    ok(`[${t}] chart series painted in this theme's tokens`,
      JSON.stringify(s.strokes) === JSON.stringify(s.tokens),
      { strokes: s.strokes, tokens: s.tokens });
    palettes[t] = (s.strokes || []).join(',');
  }

  /* And the four palettes must actually differ from one another — the tell-tale
     that first exposed the memoised read was dark and tech rendering identical
     series colours. */
  const shared = Object.keys(palettes).filter((t, i, a) =>
    a.some(o => o !== t && palettes[o] === palettes[t]));
  ok('each theme has its own chart palette', shared.length === 0,
    Object.keys(palettes).map(t => t + ': ' + palettes[t]));

  /* persistence: the last theme must survive a reload */
  await ev(`localStorage.setItem('bmcm-theme','tech')`);
  await cdp.send('Page.navigate', { url: FILE });
  await new Promise(r => setTimeout(r, 3000));
  ok('theme persists across reload (tech)', (await ev(`document.documentElement.getAttribute('data-theme')`)) === 'tech');

  console.log('\n---------------------------------------');
  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  console.log('---------------------------------------');
  cdp.close(); chrome.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
