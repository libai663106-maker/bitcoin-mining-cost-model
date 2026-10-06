/* CDP-driven audit: geometry, overflow, crashes, a11y contrast.
 * Usage: node scripts/audit.js [theme]
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.resolve(__dirname, '..');
/* The locale is part of the run, not something inherited from the Chrome
   profile: labels set the minimum column width, so "does this page fit at
   1440?" is a different question in English (widest labels) than in Chinese.
   Defaults to en — the worst case. */
const LANG = process.argv[4] || 'en';
const FILE = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') + '?lang=' + LANG;
/* Offset for running two audits side by side without fighting over the port. */
const PORT = 9223 + (Number(process.env.AUDIT_PORT_OFFSET) || 0);
const THEME = process.argv[2] || 'light';
const WIDTH = Number(process.argv[3]) || 1440;

function getJson(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

function wsUrl() {
  return getJson('/json/list').then(l => {
    const p = l.find(t => t.type === 'page');
    if (!p) throw new Error('no page target');
    return p.webSocketDebuggerUrl;
  });
}

/** minimal CDP client over the built-in WebSocket (Node 22 has global WebSocket) */
function connect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    let id = 0;
    const waiting = new Map();
    const events = [];
    const listeners = [];
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && waiting.has(m.id)) {
        const { resolve, reject } = waiting.get(m.id);
        waiting.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method) {
        events.push(m);
        listeners.forEach(fn => fn(m));
      }
    });
    ws.addEventListener('open', () => res({
      send: (method, params) => new Promise((resolve, reject) => {
        const mid = ++id;
        waiting.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
      }),
      on: fn => listeners.push(fn),
      events,
      close: () => ws.close()
    }));
    ws.addEventListener('error', rej);
  });
}

(async () => {
  const profile = path.join(ROOT, 'qa', 'profile');
  fs.mkdirSync(profile, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    '--window-size=' + Math.max(WIDTH, 400) + ',1200',
    '--force-device-scale-factor=1',
    FILE
  ], { stdio: 'ignore' });

  let cdp;
  for (let i = 0; i < 60; i++) {
    try { cdp = await connect(await wsUrl()); break; } catch (e) { await new Promise(r => setTimeout(r, 250)); }
  }
  if (!cdp) { console.error('cannot attach'); chrome.kill(); process.exit(1); }

  const logs = [], errors = [];
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  cdp.on(m => {
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception || {}).description);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text + ' @ ' + m.params.entry.url);
  });

  await cdp.send('Page.navigate', { url: FILE });
  await new Promise(r => setTimeout(r, 3500));
  /* re-apply after navigation: the window's minimum width clamps the initial
     size, so a real 390px mobile viewport needs the override to land last */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 1200, deviceScaleFactor: 1, mobile: WIDTH < 640, screenWidth: WIDTH, screenHeight: 1200 });
  await new Promise(r => setTimeout(r, 500));

  async function evaluate(expr) {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception || {}).description);
    return r.result.value;
  }

  /* set theme */
  /* The theme is applied by hand here (it has no URL channel), so the derived
     token cache has to be dropped by hand too — that is exactly what the app's
     applyTheme() does. AppData.tok() memoises on first read, and the page boots
     in the profile's remembered theme, so skipping this left the charts painted
     in the LIGHT palette while the chrome went dark: every theme audit below was
     measuring a hybrid no user can produce. Tell-tale: dark/tech/minimal render
     byte-identical series colours. */
  await evaluate(`localStorage.setItem('bmcm-theme','${THEME}'); document.documentElement.setAttribute('data-theme','${THEME}'); window.AppData && window.AppData.dropTokCache(); window.__model && window.__model.render();`);
  await new Promise(r => setTimeout(r, 900));

  const report = await evaluate(`(function(){
    var out = { theme: document.documentElement.getAttribute('data-theme'), lang: window.I18N ? window.I18N.current : null, width: innerWidth, height: innerHeight };
    out.ready = !!document.getElementById('kpiCostVal').textContent.match(/\\d/);
    out.kpi = {
      cost: document.getElementById('kpiCostVal').textContent,
      shut: document.getElementById('kpiShutVal').textContent,
      profit: document.getElementById('kpiProfitVal').textContent,
      payback: document.getElementById('kpiPayVal').textContent
    };
    out.charts = ['chartPrice','chartCost','chartHash','chartBreak','chartSens','chartElec'].map(function(id){
      var el = document.getElementById(id);
      var svg = el.querySelector('svg');
      return { id: id, hasSvg: !!svg, vb: svg ? svg.getAttribute('viewBox') : null,
               h: svg ? Math.round(svg.getBoundingClientRect().height) : 0 };
    });
    out.tables = ['econRows','mdetBody','heat','elecRows','assumptions','formulas','dataSrc'].map(function(id){
      var el = document.getElementById(id);
      return { id: id, children: el ? el.children.length : -1 };
    });
    out.bodyScrollW = document.documentElement.scrollWidth;
    out.hOverflow = document.documentElement.scrollWidth > innerWidth + 1;
    out.pageH = document.documentElement.scrollHeight;
    /* every element wider than viewport. The id and the classes are part of the
       report: "TABLE.tbl w=1527" does not say WHICH table, and this page has
       five of them. */
    var over = [];
    document.querySelectorAll('*').forEach(function(n){
      var r = n.getBoundingClientRect();
      if (r.width > innerWidth + 2 && r.height > 0 && r.width < 5000) {
        var id = n.id ? '#' + n.id : '';
        var cls = (n.className && n.className.baseVal === undefined) ? '.' + String(n.className).split(' ').join('.') : '';
        over.push(n.tagName + id + cls + ' w=' + Math.round(r.width));
      }
    });
    out.overflowing = over.slice(0, 12);
    out.nonFinite = (document.body.innerText.match(/NaN|Infinity|undefined|null/g) || []).slice(0, 10);

    /* ---- contrast audit (§55: "no black text invisible", "no white residue") ---- */
    function rgb(s){
      var m = String(s).match(/rgba?\\((\\d+)[,\\s]+(\\d+)[,\\s]+(\\d+)(?:[,\\s\\/]+([\\d.]+))?\\)/);
      return m ? { r:+m[1], g:+m[2], b:+m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
    }
    function lum(c){
      function f(v){ v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }
      return 0.2126*f(c.r) + 0.7152*f(c.g) + 0.0722*f(c.b);
    }
    /* walk up for the first opaque background */
    function bgOf(n){
      var e = n;
      while (e && e !== document.documentElement) {
        var c = rgb(getComputedStyle(e).backgroundColor);
        if (c && c.a > 0.55) return c;
        e = e.parentElement;
      }
      var b = rgb(getComputedStyle(document.body).backgroundColor);
      return b || { r:255, g:255, b:255, a:1 };
    }
    var lowContrast = [], samples = 0;
    var skipSel = 'svg text, .hot';
    document.querySelectorAll('body *').forEach(function(n){
      if (n.matches(skipSel)) return;                        /* SVG handled separately */
      if (!n.textContent || !n.textContent.trim()) return;
      if (n.children.length > 0) return;                     /* leaf text nodes only */
      var r = n.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      var st = getComputedStyle(n);
      if (st.visibility === 'hidden' || st.display === 'none' || +st.opacity === 0) return;
      var fg = rgb(st.color); if (!fg) return;
      var bg = bgOf(n);
      samples++;
      var L1 = lum(fg), L2 = lum(bg);
      var ratio = (Math.max(L1,L2) + 0.05) / (Math.min(L1,L2) + 0.05);
      var size = parseFloat(st.fontSize) || 14;
      var bold = (+st.fontWeight >= 700);
      /* WCAG AA: 3.0 for large text (>=18.66px bold or >=24px), else 4.5 */
      var need = (size >= 24 || (bold && size >= 18.66)) ? 3.0 : 4.5;
      if (ratio < need) {
        lowContrast.push({ t: (n.textContent.trim().slice(0, 28)), ratio: +ratio.toFixed(2), need: need,
                           fg: st.color, bg: 'rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ')', size: size });
      }
    });
    out.contrast = { samples: samples, fails: lowContrast.length, worst: lowContrast.sort(function(a,b){return a.ratio-b.ratio}).slice(0, 8) };

    /* surfaces must be theme-appropriate: dark themes never show near-white cards */
    var cards = [];
    document.querySelectorAll('.kpi, .panel, .card, .chartbox, .sec, header.top, body').forEach(function(n){
      var c = rgb(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.55) cards.push({ cls: String(n.className).split(' ').slice(0,2).join('.'), rel: +(lum(c)).toFixed(3) });
    });
    out.surfaces = cards.slice(0, 10);

    /* ---- responsive assertions (§50) ---- */
    function cols(sel){
      var el = document.querySelector(sel); if (!el) return null;
      var tpl = getComputedStyle(el).gridTemplateColumns || '';
      if (!tpl.trim() || tpl.trim() === 'none') return null;
      /* computed value looks like "314.5px 314.5px 314.5px 314.5px" */
      var m = tpl.match(/-?[\\d.]+px/g);
      return m ? m.length : tpl.trim().split(/\s+/).length;
    }
    out.rw = {
      width: innerWidth,
      kpiCols: cols('.kpis'),
      inputCols: cols('.in-groups'),
      chartCols: cols('.grid2'),
      kpiColsRaw: (function(){ var e=document.querySelector('.kpis'); return e ? getComputedStyle(e).gridTemplateColumns : null; })(),
      grid2Raw: (function(){ var e=document.querySelector('.grid2'); return e ? getComputedStyle(e).gridTemplateColumns : null; })(),
      themeBtnVisible: !!document.querySelector('#themeBtn') && getComputedStyle(document.querySelector('#themeBtn')).display !== 'none',
      /* tables must scroll, not blow out the page */
      tablesScrollable: [].slice.call(document.querySelectorAll('.tbl-scroll')).map(function(t){
        var cs = getComputedStyle(t);
        return { ox: cs.overflowX, scrollW: t.scrollWidth, clientW: t.clientWidth };
      }).slice(0, 4),
      /* charts must collapse to a single column on narrow screens */
      minTapSize: (function(){
        var small = [];
        document.querySelectorAll('button, select, input[type=number]').forEach(function(el){
          var r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) return;
          if (r.height < 32) small.push((el.id || el.className || el.tagName) + ' h=' + Math.round(r.height));
        });
        return small.slice(0, 8);
      })()
    };

    return out;
  })()`);

  if (process.env.AUDIT_JSON) {
    console.log(JSON.stringify({ report, logs, errors }, null, 2));
  } else {
    var r = report, rw = r.rw || {};
    console.log('  theme=' + r.theme + ' lang=' + r.lang + ' w=' + rw.width +
      '  kpi=' + rw.kpiCols + ' grid2=' + rw.chartCols + ' inputs=' + rw.inputCols +
      '  pageH=' + r.pageH);
    console.log('  errors=' + errors.length +
      '  contrastFails=' + (r.contrast ? r.contrast.fails : '?') + '/' + (r.contrast ? r.contrast.samples : '?') +
      '  hOverflow=' + r.hOverflow +
      '  nonFinite=' + r.nonFinite.length +
      '  charts=' + r.charts.filter(function (c) { return c.hasSvg; }).length + '/' + r.charts.length);
    if (r.overflowing.length) console.log('  overflowing: ' + JSON.stringify(r.overflowing.slice(0, 4)));
    if (errors.length) errors.slice(0, 5).forEach(function (e) { console.log('  ERR ' + e.slice(0, 160)); });
    if (r.contrast && r.contrast.worst.length) r.contrast.worst.slice(0, 4).forEach(function (w) {
      console.log('  LOW-CONTRAST ' + w.ratio + ' (need ' + w.need + ') ' + JSON.stringify(w.t));
    });
  }
  cdp.close();
  chrome.kill();
  process.exit(0);
})().catch(e => { console.error('AUDIT FAILED', e); process.exit(1); });
