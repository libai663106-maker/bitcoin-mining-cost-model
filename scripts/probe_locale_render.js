/* Visual capture of the three locales, plus an untranslated-string audit.
 *
 * The audit is the important half: it walks every visible text node and flags
 * any that is still English while a Chinese locale is active. That is how we
 * catch copy that was never tagged, which a screenshot review would miss.
 *
 * Run: node scripts/probe_locale_render.js [zh-CN|zh-TW|en]
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9250 + Math.floor(Math.random() * 120);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const WANT = process.argv[2] || 'zh-CN';

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
    '--window-size=1440,1100', '--user-data-dir=' + path.join(ROOT, 'qa', '.chrome-locale'),
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

  await cdp(ws, 'Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?lang=' + WANT }, sessionId);
  await new Promise(r => setTimeout(r, 3400));

  const ev = async (expr, byValue = true) => {
    const { result, exceptionDetails } = await cdp(ws, 'Runtime.evaluate', {
      expression: expr, returnByValue: byValue, awaitPromise: true
    }, sessionId);
    if (exceptionDetails) return { __err: exceptionDetails.text };
    return result.value;
  };

  h('locale ' + WANT + ' is applied to the document');
  const lang = await ev(`document.documentElement.getAttribute('lang')`);
  ok('html lang attribute matches', lang === WANT, lang);

  /* ---------- untranslated copy audit ---------- */
  /* A leaf is a genuine leak only when a Chinese locale is active AND the leaf
     contains ASCII words but NO CJK characters at all. Token-matching alone is
     useless here: legitimate Chinese copy routinely embeds Latin tokens
     ("BTC 币价", "挖矿 ROI", "每 TH 算力"), and a regex would flag all of them.
     CJK density is the honest discriminator. Numbers, units and tickers are
     excluded separately.

     SVG internals used to be skipped wholesale (`el.closest('svg')`), which
     meant every axis caption, series label and unit baked into a chart string
     was invisible to this audit — that is how a hard-coded "HALVING" shipped
     inside the Chinese UI. Only geometry is skipped now: <text>/<tspan> are
     audited like any other leaf, because they *are* the copy. */
  /* Kept as a named expression: the second pass below re-runs it against a
     state that renders a chart branch the default view never reaches. */
  const AUDIT = `(function(){
    var asciiWord = /[A-Za-z]{3,}/;
    var cjk = /[\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\u3040-\\u30ff]/;
    /* Units, tickers, pure numerics, bare symbols — never prose. */
    var skip = /^(BTC|BTC\\/TH|TH\\/s|EH\\/s|J\\/TH|W|kW|kWh|MW|GW|USD|USDT|CNY|sats|N\\/A|n\\/a|OK|ROI|APR|IRR|CAPEX|capex|NPV|—|–|-|%|\\$|[\\d.,+\\-%\\s\\/]*([A-Za-z]{1,4})?[\\d.,+\\-%\\s\\/]*)$/;
    /* Known product nouns that stay Latin in every locale by editorial choice. */
    var brand = /^(Bitcoin Mining Cost Model|Bitcoin|Bitmain|Antminer|Whatsminer|mempool\\.space|BTC|USD|SHA-256|Scrypt|ASIC|J\\/TH|TH\\/s|EH\\/s)$/i;
    /* Data, not copy: endpoints, ISO timestamps, handles, money/tariff tokens.
       These are locale-invariant by nature — translating them would corrupt the
       value being displayed. */
    var data = [
      /^[·\\s]*\\//,                                  /* "/api/v1/..." breadcrumbs */
      /^[·\\s]*[a-z0-9.-]+\\.[a-z]{2,}\\//i,             /* host/path */
      /\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}/,               /* ISO timestamp */
      /^@[\\w.-]+$/,                                   /* @handle */
      /^https?:\\/\\//,                                 /* URL */
      /^\\$[\\d.,]+\\s*\\/\\s*[A-Za-z]+$/,                   /* "$0.030 / kWh" */
      /^\\$[\\d.,]+(\\s*\\/\\s*[A-Za-z]+)?$/,                 /* "$122,035" / "$122,035/BTC" */
      /^\\$[\\d.,]+\\s+\\/\\s*[A-Za-z]+$/
    ];
    var out = [];
    var nodes = document.querySelectorAll('.wrap *, header.top *, .foot *, .theme-pop *');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.children.length) continue;
      /* Charts are drawn into the same .wrap tree, so their <text> nodes reach
         here. Audit them; skip the geometric primitives that carry no copy. */
      var svg = el.closest && el.closest('svg');
      if (svg) {
        var tn = el.tagName.toLowerCase();
        if (tn !== 'text' && tn !== 'tspan') continue;
      }
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      var t = (el.textContent || '').trim();
      if (!t || t.length < 3) continue;
      if (cjk.test(t)) continue;              /* already localized */
      if (!asciiWord.test(t)) continue;       /* no prose, just symbols */
      if (skip.test(t)) continue;
      if (brand.test(t)) continue;
      if (data.some(function (re) { return re.test(t); })) continue;
      out.push(label(el) + ' :: ' + t.slice(0, 70));
    }

    /* An SVG element's className is an SVGAnimatedString, so the usual
       .className shorthand prints "[object SVGAnimatedString]" and every
       chart leak came back anonymous. Label SVG nodes by tag + class instead. */
    function label(el) {
      if (el.closest && el.closest('svg')) {
        var cls = el.getAttribute('class');
        return '<' + el.tagName + (cls ? '.' + cls.split(' ')[0] : '') + '>';
      }
      if (el.id) return '#' + el.id;
      if (el.className && typeof el.className === 'string') return '.' + el.className.split(' ')[0];
      return el.tagName;
    }
    return out;
  })()`;

  const leaks = await ev(AUDIT);

  if (Array.isArray(leaks)) {
    console.log('  untranslated candidates: ' + leaks.length);
    leaks.slice(0, 40).forEach(l => console.log('    - ' + l));
    if (WANT === 'en') {
      ok('english locale has no leak check (it IS the source language)', true);
    } else {
      ok('zero untagged English-only leaves', leaks.length === 0, leaks.length);
    }
  } else {
    ok('audit ran', false, leaks);
  }

  /* ---------- untranslated copy audit, no-production branch ----------
     Zero uptime drives miner BTC/day to zero, which is the one input a user can
     actually reach that swaps `Mining vs Buy & Hold` for its "N/A — no BTC"
     placeholder. That text lives inside the SVG, so it only became auditable
     after the geometry skip above was narrowed. */
  if (WANT !== 'en') {
    h('no-production branch (' + WANT + ')');
    await ev(`window.__model.set('uptime', 0)`);
    await new Promise(r => setTimeout(r, 400));

    const leaksNoBtc = await ev(AUDIT);
    if (Array.isArray(leaksNoBtc)) {
      console.log('  untranslated candidates: ' + leaksNoBtc.length);
      leaksNoBtc.slice(0, 20).forEach(l => console.log('    - ' + l));
      ok('zero untagged English-only leaves with zero production', leaksNoBtc.length === 0, leaksNoBtc.length);
    } else {
      ok('no-production audit ran', false, leaksNoBtc);
    }
    await ev(`window.__model.resetToLive()`);
    await new Promise(r => setTimeout(r, 300));
  }

  /* ---------- chart text inventory ----------
     Every axis caption, series label and unit that a reviewer would otherwise
     have to squint at in a screenshot. Printing it makes the chart copy part of
     the readable output instead of something only the leak check sees. */
  const chartText = await ev(`(function(){
    var out = [];
    [].forEach.call(document.querySelectorAll('.chartbox svg text'), function (t) {
      var v = (t.textContent || '').trim();
      if (v) out.push(v);
    });
    return out;
  })()`);
  if (Array.isArray(chartText)) {
    console.log('\n== chart text (' + chartText.length + ' nodes) ==');
    console.log('  ' + chartText.join('  |  '));
  } else {
    ok('chart text dump ran', false, chartText);
  }

  /* ---------- screenshots ---------- */
  fs.mkdirSync(path.join(ROOT, 'qa'), { recursive: true });
  await ev(`window.scrollTo(0,0)`);
  await cdp(ws, 'Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 2400, deviceScaleFactor: 1, mobile: false }, sessionId);
  await new Promise(r => setTimeout(r, 500));
  const { data } = await cdp(ws, 'Page.captureScreenshot', { format: 'png' }, sessionId);
  const out = path.join(ROOT, 'qa', 'lang-' + WANT + '.png');
  fs.writeFileSync(out, Buffer.from(data, 'base64'));
  console.log('  screenshot -> ' + out);

  console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILED') + '  ' + pass + ' passed / ' + fail + ' failed');
  ws.close(); proc.kill(); server.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
