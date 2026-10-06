/* Mobile verification (§50) — headless Chrome floors the outer viewport at
 * ~493px on Windows, so a true 390px viewport is measured inside an iframe
 * sized to the target width. The audit runs against the iframe document.
 *
 * Usage: node scripts/mobile_audit.js [width] [theme]
 */
const http = require('http'), path = require('path'), fs = require('fs');
const { spawn } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.resolve(__dirname, '..');
const W = Number(process.argv[2]) || 390;
const THEME = process.argv[3] || 'light';
const PORT = 9700 + Math.floor(Math.random() * 90);
const WEB_PORT = 8300 + Math.floor(Math.random() * 90);

const HARNESS = path.join(ROOT, 'qa', '_mobile.html');
fs.writeFileSync(HARNESS,
  '<!doctype html><meta charset="utf-8"><title>mobile harness</title>' +
  '<style>html,body{margin:0;padding:0;background:#222}#f{width:' + W +
  'px;height:1140px;border:0;display:block;background:#fff}</style>' +
  '<iframe id="f" src="/index.html?lang=en"></iframe>');

/* file:// iframes are cross-origin (origin "null"), so the harness and the app
   must be served over http for the audit to reach into the iframe document. */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'qa/_mobile.html';
  const p = path.join(ROOT, rel);
  if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
});
const FILE = 'http://127.0.0.1:' + WEB_PORT + '/qa/_mobile.html';
const OUT = path.join(ROOT, 'qa');

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
  await new Promise(r => server.listen(WEB_PORT, '127.0.0.1', r));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(OUT, 'profile-mob'),
    '--window-size=1200,1200', FILE
  ], { stdio: 'ignore' });

  let cdp;
  for (let i = 0; i < 60; i++) { try { cdp = await connect((await getJson('/json/list')).find(t => t.type === 'page').webSocketDebuggerUrl); break; } catch (e) { await new Promise(r => setTimeout(r, 250)); } }
  if (!cdp) { chrome.kill(); throw new Error('no attach'); }

  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: FILE });
  await new Promise(r => setTimeout(r, 3500));

  const ev = async e => {
    const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception || {}).description);
    return r.result.value;
  };

  /* wait for the iframe document to be reachable before touching it */
  for (let i = 0; i < 40; i++) {
    const ready = await ev(`(function(){
      var f = document.getElementById('f');
      try { return !!(f && f.contentDocument && f.contentDocument.readyState === 'complete' && f.contentDocument.getElementById('kpiCostVal')); }
      catch (e) { return false; }
    })()`);
    if (ready) break;
    await new Promise(r => setTimeout(r, 250));
  }

  /* reach into the iframe */
  await ev(`(function(){
    var d = document.getElementById('f').contentDocument;
    if (!d) return 'no-doc';
    d.documentElement.setAttribute('data-theme','${THEME}');
    try { d.defaultView.localStorage.setItem('bmcm-theme','${THEME}'); } catch(e){}
    /* Same reason as audit.js: charts resolve colours through AppData.tok(),
       which memoises — without the drop the charts keep the boot theme's
       palette and this audit measures a hybrid. */
    if (d.defaultView.AppData) d.defaultView.AppData.dropTokCache();
    if (d.defaultView.__model) d.defaultView.__model.render();
    return 'ok';
  })()`);
  await new Promise(r => setTimeout(r, 900));

  const rep = await ev(`(function(){
    var w = document.getElementById('f').contentWindow;
    var d = w.document;
    function cols(sel){
      var el = d.querySelector(sel); if(!el) return null;
      var tpl = w.getComputedStyle(el).gridTemplateColumns || '';
      if (!tpl.trim() || tpl.trim()==='none') return null;
      var m = tpl.match(/-?[0-9.]+px/g);
      return m ? m.length : null;
    }
    var over = [];
    d.querySelectorAll('*').forEach(function(n){
      var r = n.getBoundingClientRect();
      var cs = w.getComputedStyle(n);
      if (r.height <= 0) return;
      if (r.right > w.innerWidth + 2 || r.width > w.innerWidth + 2) {
        var insideScroll = false;
        for (var a = n.parentElement; a; a = a.parentElement) {
          var acs = w.getComputedStyle(a);
          if (acs.overflowX === 'auto' || acs.overflowX === 'scroll') { insideScroll = true; break; }
        }
        over.push({ tag: n.tagName, cls: (typeof n.className === 'string' ? n.className : '').slice(0,40),
                    w: Math.round(r.width), right: Math.round(r.right), left: Math.round(r.left),
                    ox: cs.overflowX, insideScroll: insideScroll });
      }
    });
    over.sort(function(a,b){ return b.right - a.right; });
    var tbl = [].slice.call(d.querySelectorAll('.tbl-scroll')).map(function(t){
      return { ox: w.getComputedStyle(t).overflowX, scrollW: t.scrollWidth, clientW: t.clientWidth, scrollable: t.scrollWidth > t.clientWidth };
    });
    var small = [];
    d.querySelectorAll('button, select, input').forEach(function(el){
      var r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      if (r.height < 28) small.push((el.id || (typeof el.className==='string'?el.className:'') || el.tagName) + ' h=' + Math.round(r.height));
    });
    return {
      innerW: w.innerWidth,
      scrollW: d.documentElement.scrollWidth,
      pageH: d.documentElement.scrollHeight,
      hOverflow: d.documentElement.scrollWidth > w.innerWidth + 1,
      kpiCols: cols('.kpis'), grid2Cols: cols('.grid2'), inputCols: cols('.in-groups'),
      overflowing: over.slice(0, 8),
      wideChain: (function(){
        var out = [];
        d.querySelectorAll('body *').forEach(function(n){
          if (n.scrollWidth > n.clientWidth + 1 && n.clientWidth > 0) {
            var r = n.getBoundingClientRect();
            var kids = [].slice.call(n.children).map(function(c){
              var cr = c.getBoundingClientRect();
              return c.tagName + '.' + (typeof c.className==='string'?c.className.split(' ')[0]:'') + '=' + Math.round(cr.width);
            }).join(', ');
            out.push({ tag: n.tagName, cls: (typeof n.className==='string'?n.className:'').slice(0,44),
                       scrollW: n.scrollWidth, clientW: n.clientWidth, boxW: Math.round(r.width),
                       ox: w.getComputedStyle(n).overflowX, disp: w.getComputedStyle(n).display,
                       kids: kids.slice(0, 120), path: (function(){ var a=[],e=n; while(e&&e.tagName!=='BODY'){ a.unshift(e.tagName+'.'+(typeof e.className==='string'?e.className.split(' ')[0]:'')); e=e.parentElement;} return a.join('>'); })() });
          }
        });
        out.sort(function(a,b){ return (b.scrollW-b.clientW) - (a.scrollW-a.clientW); });
        return out.slice(0, 10);
      })(),
      tables: tbl,
      smallTargets: small.slice(0, 10),
      themeBtn: !!d.getElementById('themeBtn') ? w.getComputedStyle(d.getElementById('themeBtn')).display : 'missing',
      /* is the theme popup portalled to body (required for the bottom sheet)? */
      themePopParent: (function(){ var p = d.querySelector('.theme-pop'); return p ? (p.parentElement === d.body ? 'body' : p.parentElement.tagName) : 'missing'; })(),
      nonFinite: (d.body.innerText.match(/NaN|Infinity|undefined/g) || []).slice(0, 6),
      charts: [].slice.call(d.querySelectorAll('.chartbox svg')).length
    };
  })()`);

  console.log('width=' + rep.innerW + ' theme=' + THEME);
  console.log('  scrollW=' + rep.scrollW + ' pageH=' + rep.pageH);
  if (rep.wideChain && rep.wideChain.length) {
    console.log('  --- elements whose content is wider than their box ---');
    rep.wideChain.forEach(function (x) { console.log('    ' + x.path + '\n       scrollW=' + x.scrollW + ' clientW=' + x.clientW + ' boxW=' + x.boxW + ' ovX=' + x.ox + '\n       kids: ' + x.kids); });
  }
  ok('viewport is the requested width', rep.innerW === W, { want: W, got: rep.innerW });
  ok('no horizontal overflow', !rep.hOverflow, { scrollW: rep.scrollW, innerW: rep.innerW });
  ok('KPI grid is 2 columns on mobile (§50)', rep.kpiCols === 2, rep.kpiCols);
  ok('input grid is 1 column on mobile (§50)', rep.inputCols === 1, rep.inputCols);
  ok('chart pairs collapse to 1 column', rep.grid2Cols === 1, rep.grid2Cols);
  ok('all 6 charts still render', rep.charts === 6, rep.charts);
  ok('no NaN/Infinity in visible text', rep.nonFinite.length === 0, rep.nonFinite);
  ok('theme button visible on mobile', rep.themeBtn !== 'none' && rep.themeBtn !== 'missing', rep.themeBtn);
  ok('theme popup is portalled to <body>', rep.themePopParent === 'body', rep.themePopParent);
  ok('wide tables scroll horizontally instead of overflowing',
    rep.tables.every(t => t.scrollable ? (t.ox === 'auto' || t.ox === 'scroll') : true),
    rep.tables);
  ok('overflowing elements are confined to scrollable tables',
    rep.overflowing.every(function (s) {
      return s.insideScroll && /^(TABLE|THEAD|TBODY|TR|TH|TD|COLGROUP|COL)$/.test(s.tag);
    }),
    rep.overflowing.filter(function (s) { return !s.insideScroll; }));

  /* screenshot the iframe viewport */
  const box = await ev(`(function(){ var r=document.getElementById('f').getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height}; })()`);
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: box.x, y: box.y, width: box.w, height: Math.min(box.h, 1140), scale: 1 },
    captureBeyondViewport: true
  });
  fs.writeFileSync(path.join(OUT, 'mobile_' + W + '_' + THEME + '.png'), Buffer.from(shot.data, 'base64'));
  console.log('  wrote qa/mobile_' + W + '_' + THEME + '.png');

  console.log('\n---------------------------------------');
  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  console.log('---------------------------------------');
  cdp.close(); chrome.kill(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAILED', e); try { server.close(); } catch (x) {} process.exit(1); });
