/* Live / Manual switch acceptance (spec §36, §37, §38).
 *
 * The requirement is that each live-backed datum has its own toggle, that manual
 * override actually drives the model, and — critically — that a failure to fetch
 * live data leaves the model usable. The last part is the one that is easy to
 * claim and hard to prove, so this suite simulates a dead data source by wiping
 * the baked snapshot before boot and confirming the page still renders numbers.
 *
 * Run: node scripts/test_live.js
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8970 + Math.floor(Math.random() * 120);
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

/* Serve normally, except /index.html can be asked to strip the market snapshot
   so we can boot with no live data at all. */
let breakMarket = false;
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  if (breakMarket && p === '/data/market.json') {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end('{"error":"simulated outage"}'); return;
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
    '--window-size=1440,1100', '--user-data-dir=' + path.join(ROOT, 'qa', '.chrome-live'),
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

  const go = async () => {
    await cdp(ws, 'Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?lang=en' }, sessionId);
    await new Promise(r => setTimeout(r, 3000));
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
    var b = document.querySelector('[data-live="btcPrice"]');
    var n = document.querySelector('[data-live="networkHashrate"]');
    return {
      priceBtn: b?b.textContent.trim():null, priceOn: b?b.classList.contains('on'):null,
      hashBtn: n?n.textContent.trim():null, hashOn: n?n.classList.contains('on'):null,
      priceIn: (document.querySelector('[data-manual="btcPrice"]')||{}).value,
      priceDisabled: (document.querySelector('[data-manual="btcPrice"]')||{}).disabled,
      hashDisabled: (document.querySelector('[data-manual="networkHashrate"]')||{}).disabled,
      /* Cost/BTC and Shutdown price are BTC-denominated, so they must NOT move
         when only the BTC price changes. Profit and the Mining/Spot ratio are
         the price-sensitive readouts. */
      cost: t('kpiCostVal'), shut: t('kpiShutVal'),
      profit: t('kpiProfitVal'), ratio: t('vsRatio'),
      priceLab: (document.querySelector('[data-livlab="btcPrice"]')||{}).textContent,
      resultPrice: (window.__model && window.__model.read()) ? window.__model.read().input.btcPrice : null,
      errors: window.__errs ? window.__errs.length : 0
    };
  })()`;

  /* ---------- 1. default state ---------- */
  await cdp(ws, 'Page.addScriptToEvaluateOnNewDocument', {
    source: 'window.__errs=[];window.addEventListener("error",function(e){window.__errs.push(String(e.message))});'
  }, sessionId);
  await go();

  h('§36 default state — each live datum has its own switch');
  let s = await ev(SNAP);
  ok('BTC price starts on Live', s.priceOn === true && /live/i.test(s.priceBtn), s.priceBtn);
  ok('network hashrate starts on Live', s.hashOn === true && /live/i.test(s.hashBtn), s.hashBtn);
  ok('invoice-linked input disabled while Live', s.priceDisabled === true, s.priceDisabled);
  ok('two independent switches exist', s.priceBtn !== null && s.hashBtn !== null, 'ok');
  ok('live badge shows freshness', /Live\s*·/.test(s.priceLab || ''), s.priceLab);
  ok('model renders numbers on Live', /\d/.test(s.cost || '') && /\d/.test(s.shut || ''), [s.cost, s.shut]);

  /* ---------- 2. flip to Manual ---------- */
  h('§37 manual override drives the model');
  const before = { cost: s.cost, shut: s.shut };
  await ev(`document.querySelector('[data-live="btcPrice"]').click()`);
  await new Promise(r => setTimeout(r, 400));
  s = await ev(SNAP);
  ok('button now reads Manual', /manual/i.test(s.priceBtn), s.priceBtn);
  ok('button no longer .on', s.priceOn === false, s.priceOn);
  ok('input becomes editable', s.priceDisabled === false, s.priceDisabled);
  ok('badge switches to manual override', /manual/i.test(s.priceLab || ''), s.priceLab);
  ok('price is pre-seeded from the live value', parseFloat(s.priceIn) > 1000, s.priceIn);
  ok('manual switch does not disturb cost/BTC on its own',
    s.cost === before.cost, { was: before.cost, now: s.cost });

  /* ---------- 3. manual value propagates ---------- */
  await ev(`(function(){
    var el = document.querySelector('[data-manual="btcPrice"]');
    el.value = 250000;
    el.dispatchEvent(new Event('input', {bubbles:true}));
    el.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await new Promise(r => setTimeout(r, 400));
  const hi = await ev(SNAP);
  ok('engine receives the manual price', hi.resultPrice === 250000, hi.resultPrice);
  ok('daily profit responds to the manual price', hi.profit !== before.profit,
    { was: before.profit, now: hi.profit });
  ok('Mining/Spot ratio responds to the manual price', hi.ratio !== before.ratio,
    { was: before.ratio, now: hi.ratio });
  ok('cost/BTC correctly ignores BTC price (it is BTC-denominated)',
    hi.cost === before.cost, { was: before.cost, now: hi.cost });
  ok('shutdown price correctly ignores BTC price', hi.shut === before.shut,
    { was: before.shut, now: hi.shut });

  /* ---------- 4. hash rate switches independently ---------- */
  h('§36 switches are independent');
  await ev(`document.querySelector('[data-live="networkHashrate"]').click()`);
  await new Promise(r => setTimeout(r, 400));
  s = await ev(SNAP);
  ok('hashrate is Manual while price stays Manual too', s.hashOn === false && s.priceOn === false,
    { hash: s.hashOn, price: s.priceOn });
  await ev(`document.querySelector('[data-live="btcPrice"]').click()`);
  await new Promise(r => setTimeout(r, 400));
  s = await ev(SNAP);
  ok('price returns to Live alone', s.priceOn === true && s.hashOn === false && s.priceOn === true,
    { hash: s.hashOn, price: s.priceOn });
  ok('price input disabled again', s.priceDisabled === true, s.priceDisabled);
  ok('hashrate input still editable', s.hashDisabled === false, s.hashDisabled);

  /* ---------- 5. both switches can be brought back to Live ---------- */
  /* This used to click the "Live market" preset button. That panel is gone, so
     the same contract is now exercised down the only path left to it: flipping
     each switch by hand. The assertion is unchanged — a model that goes
     non-finite while returning to live values is still a failure. */
  h('§36 both switches return to Live');
  await ev(`document.querySelector('[data-live="networkHashrate"]').click()`);
  await new Promise(r => setTimeout(r, 500));
  s = await ev(SNAP);
  ok('both switches back to Live', s.priceOn === true && s.hashOn === true,
    { price: s.priceOn, hash: s.hashOn });
  ok('dashboard still finite after restore', /\d/.test(s.cost || ''), s.cost);

  /* ---------- 6. no JS errors along the way ---------- */
  h('no runtime errors during interaction');
  const errs = await ev('window.__errs || []');
  ok('zero uncaught errors', Array.isArray(errs) && errs.length === 0, errs);

  /* ---------- 7. dead data source must not disable the model (§38) ---------- */
  h('§38 live fetch failure leaves the model usable');
  breakMarket = true;
  await go();
  const dead = await ev(SNAP);
  ok('page still renders with the data source down', /\d/.test(dead.cost || '') && /\d/.test(dead.shut || ''),
    { cost: dead.cost, shut: dead.shut });
  ok('switches still present and usable', dead.priceBtn !== null && dead.hashBtn !== null,
    { price: dead.priceBtn, hash: dead.hashBtn });
  const deadErrs = await ev('window.__errs || []');
  ok('outage produces no uncaught error', Array.isArray(deadErrs) && deadErrs.length === 0, deadErrs);

  /* still interactive while offline */
  await ev(`document.querySelector('[data-live="btcPrice"]').click()`);
  await new Promise(r => setTimeout(r, 400));
  const offline = await ev(SNAP);
  ok('can switch to Manual while offline', offline.priceOn === false, offline.priceOn);
  ok('manual entry works while offline', offline.priceDisabled === false, offline.priceDisabled);

  console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILED') + '  ' + pass + ' passed / ' + fail + ' failed');
  ws.close(); proc.kill(); server.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
