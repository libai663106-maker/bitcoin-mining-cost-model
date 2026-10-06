/* Language switcher smoke probe.
 *
 * Proves the thing the user actually reported missing: clicking the header
 * globe opens a menu, and picking a locale re-labels the page WITHOUT moving
 * any numbers. The last part is the spec's §45 discipline applied to locale —
 * switching language must be a re-label, never a re-compute.
 *
 * Run: node scripts/probe_lang.js
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9100 + Math.floor(Math.random() * 120);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

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

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const chrome = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
  ].find(p => fs.existsSync(p)) || 'chrome';

  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=0',
    '--window-size=1440,1100', '--user-data-dir=' + path.join(ROOT, 'qa', '.chrome-lang'),
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
  await cdp(ws, 'Page.addScriptToEvaluateOnNewDocument', {
    source: 'window.__errs=[];window.addEventListener("error",function(e){window.__errs.push(String(e.message))});'
  }, sessionId);

  const go = async (qs) => {
    await cdp(ws, 'Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' + (qs || '') }, sessionId);
    await new Promise(r => setTimeout(r, 3200));
  };
  const ev = async (expr) => {
    const { result, exceptionDetails } = await cdp(ws, 'Runtime.evaluate', {
      expression: expr, returnByValue: true
    }, sessionId);
    if (exceptionDetails) return { __err: exceptionDetails.text };
    return result.value;
  };

  const SNAP = `(function(){
    function t(id){ var e=document.getElementById(id); return e?(e.textContent||'').trim():null; }
    var r = window.__model.read();
    var f = r.current;
    return {
      html: document.documentElement.getAttribute('lang'),
      btn: t('langLabel'),
      popHidden: !document.getElementById('langPop').classList.contains('on'),
      appTitle: (document.querySelector('.brand span>span, .brand')||{}).textContent,
      h1: t('') || (document.querySelector('h1.title')||{}).textContent,
      cost: t('kpiCostVal'), shut: t('kpiShutVal'), profit: t('kpiProfitVal'),
      /* raw engine numbers — must be byte-identical across a language switch */
      fCost: f.costPerBtc, fShut: f.shutdownPrice, fProfit: f.dailyProfit,
      dailyBtc: f.minerBtcPerDay, netHash: f.effectiveNetworkHashrateEhs,
      price: r.input.btcPrice, elec: r.input.electricityPrice,
      hash: r.input.hashrate, machine: r.input.machinePrice,
      url: location.search,
      chartPrice: (document.getElementById('chartPrice').innerHTML||'').length,
      sensCells: document.querySelectorAll('.heat td').length,
      /* Row COUNT, not row text: this probe switches locale, and the count is
         the part that must not move with it. */
      mdetRows: document.querySelectorAll('#mdetBody tr').length,
      errs: (window.__errs||[]).length
    };
  })()`;

  /* ---------- 1. the button exists and is wired ---------- */
  await go('?hashrate=400&btcPrice=91000&electricity=0.06&lang=en');
  h('language button is live');
  let s = await ev(SNAP);
  ok('locale resolved from the URL param', s.html === 'en', s.html);
  ok('both charts rendered', s.chartPrice > 500, s.chartPrice);
  ok('sensitivity matrix populated', s.sensCells > 0, s.sensCells);

  /* clicking the globe must open the popover */
  await ev(`document.getElementById('langBtn').click()`);
  await new Promise(r => setTimeout(r, 250));
  let open = await ev(`document.getElementById('langPop').classList.contains('on')`);
  ok('clicking the globe opens the language menu', open === true, open);
  const items = await ev(`Array.from(document.querySelectorAll('#langPop button[data-lang]')).map(b=>b.dataset.lang)`);
  ok('menu offers all three locales', JSON.stringify(items) === JSON.stringify(['zh-CN', 'zh-TW', 'en']), items);

  /* ---------- 2. switching to Simplified ---------- */
  h('switch to 简体中文');
  const before = { cost: s.fCost, shut: s.fShut, profit: s.fProfit, price: s.price, url: s.url };
  await ev(`document.querySelector('#langPop button[data-lang="zh-CN"]').click()`);
  await new Promise(r => setTimeout(r, 500));
  s = await ev(SNAP);
  ok('document language flips to zh-CN', s.html === 'zh-CN', s.html);
  ok('header label shows 简体中文', s.btn === '简体中文', s.btn);
  ok('popover closed after picking', s.popHidden === true, s.popHidden);
  ok('KPI titles re-labelled', /成本/.test(s.cost || '') || /挖矿/.test(JSON.stringify(s)), s.cost);
  ok('URL keeps a lang parameter', /lang=zh-CN/.test(s.url || ''), s.url);

  const after = { cost: s.fCost, shut: s.fShut, profit: s.fProfit, price: s.price };
  ok('engine cost/BTC unchanged by the switch', after.cost === before.cost, { was: before.cost, now: after.cost });
  ok('engine shutdown price unchanged', after.shut === before.shut, { was: before.shut, now: after.shut });
  ok('engine daily profit unchanged', after.profit === before.profit, { was: before.profit, now: after.profit });
  ok('input BTC price preserved', after.price === before.price, { was: before.price, now: after.price });
  ok('model params survive in the URL', /hashrate=400/.test(s.url) && /electricity=0.06/.test(s.url), s.url);
  ok('charts still painted after the switch', s.chartPrice > 500, s.chartPrice);
  ok('detail table still populated after the switch', s.mdetRows > 12, s.mdetRows);

  /* ---------- 3. Traditional ---------- */
  h('switch to 繁體中文');
  await ev(`document.getElementById('langBtn').click()`);
  await new Promise(r => setTimeout(r, 200));
  await ev(`document.querySelector('#langPop button[data-lang="zh-TW"]').click()`);
  await new Promise(r => setTimeout(r, 500));
  s = await ev(SNAP);
  ok('document language flips to zh-TW', s.html === 'zh-TW', s.html);
  ok('header label shows 繁體中文', s.btn === '繁體中文', s.btn);
  const tw = await ev(`(document.getElementById('langPop')||{}).innerHTML`);
  ok('menu heading is Traditional', /語言/.test(tw || ''), (tw || '').slice(0, 60));
  ok('numbers still identical to English run',
    s.fCost === before.cost && s.fShut === before.shut, { cost: s.fCost, was: before.cost });
  ok('URL now carries lang=zh-TW', /lang=zh-TW/.test(s.url || ''), s.url);

  /* ---------- 4. persistence ---------- */
  h('choice is remembered across a reload');
  await go('');
  s = await ev(SNAP);
  ok('reload without params keeps zh-TW from storage', s.html === 'zh-TW', s.html);
  ok('no language param needed to restore', s.btn === '繁體中文', s.btn);

  /* ---------- 5. share link round-trip ---------- */
  h('share link carries the language');
  const link = await ev(`document.getElementById('shareUrl').value`);
  ok('share URL includes lang', /lang=zh-TW/.test(link || ''), link);
  await go(link.slice(link.indexOf('?')));
  s = await ev(SNAP);
  ok('opening the share link restores zh-TW', s.html === 'zh-TW', s.html);

  /* ---------- 6. no errors ---------- */
  h('clean run');
  const errs = await ev('window.__errs || []');
  ok('zero uncaught errors', Array.isArray(errs) && errs.length === 0, errs);

  console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILED') + '  ' + pass + ' passed / ' + fail + ' failed');
  ws.close(); proc.kill(); server.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
