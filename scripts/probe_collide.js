/* Text-collision probe for the six charts. Two labels in the same axis gutter
 * must not overlap. Compares every text node's bounding box against every other
 * one that shares horizontal space.
 * Run: node scripts/probe_collide.js [theme] [lang]
 *
 * The locale axis matters because the Chinese labels are newly wired into the
 * chart strings and differ in length from their English sources ("BTC 币价
 * $86.4k" against "BTC price $86.4k"). One Chinese pass is enough for every
 * theme: --f-sans / --f-mono are declared once in tokens.css and no theme
 * overrides them, so the geometry is colour-independent.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const THEME = process.argv[2] || 'light';
const LANG = process.argv[3] || 'en';
const PORT = 8810 + Math.floor(Math.random() * 120);
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png'
};

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

/* Report per-chart, per-SVG-space box of every text node. */
const PROBE = `(function(){
  function scan(containerId){
    var box = document.getElementById(containerId);
    if (!box) return null;
    var svg = box.querySelector('svg');
    if (!svg) return null;
    var sr = svg.getBoundingClientRect();
    var vb = (svg.getAttribute('viewBox')||'0 0 1 1').split(/\\s+/).map(Number);
    var sx = vb[2] / sr.width, sy = vb[3] / sr.height;
    var out = [];
    var texts = svg.querySelectorAll('text');
    for (var i=0;i<texts.length;i++){
      var t = texts[i], r = t.getBoundingClientRect();
      out.push({
        txt: (t.textContent||'').trim(),
        x: +((r.x - sr.x) * sx).toFixed(2),
        y: +((r.y - sr.y) * sy).toFixed(2),
        w: +(r.width * sx).toFixed(2),
        h: +(r.height * sy).toFixed(2)
      });
    }
    return out;
  }
  var res = {};
  ['chartSens', 'chartPrice', 'chartCost', 'chartHash', 'chartBreak', 'chartElec'].forEach(function(id){
    var r = scan(id);
    if (r) res[id] = r;
  });
  return res;
})()`;

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const chrome = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
  ].find(p => fs.existsSync(p)) || 'chrome';

  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=0',
    '--window-size=1440,1100', '--user-data-dir=' + path.join(ROOT, 'qa', '.chrome-collide'),
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
  await cdp(ws, 'Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?lang=' + LANG }, sessionId);
  await new Promise(r => setTimeout(r, 3000));
  await cdp(ws, 'Runtime.evaluate', {
    expression: `try{localStorage.setItem('bmcm-theme','${THEME}');}catch(e){}; location.reload();`
  }, sessionId);
  await new Promise(r => setTimeout(r, 3000));

  const { result } = await cdp(ws, 'Runtime.evaluate', {
    expression: PROBE, returnByValue: true
  }, sessionId);
  const charts = result.value || {};

  let bad = 0;
  Object.keys(charts).forEach(cid => {
    const ts = charts[cid];
    const hits = [];
    for (let i = 0; i < ts.length; i++) {
      for (let j = i + 1; j < ts.length; j++) {
        const a = ts[i], b = ts[j];
        /* overlap if boxes intersect on both axes with >0.5px penetration */
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 0.5 && oy > 0.5) {
          hits.push('"' + a.txt + '" [' + a.x + ',' + a.y + ' +' + a.w + 'x' + a.h + ']'
            + '  X  "' + b.txt + '" [' + b.x + ',' + b.y + ' +' + b.w + 'x' + b.h + ']'
            + '  (overlap ' + ox.toFixed(1) + 'x' + oy.toFixed(1) + ')');
        }
      }
    }
    if (hits.length) {
      bad += hits.length;
      console.log('\n## ' + cid + ' — ' + hits.length + ' collision(s)');
      hits.forEach(h => console.log('   ' + h));
    }
  });

  if (!bad) console.log('No text collisions in ' + Object.keys(charts).length + ' charts (' + THEME + ')');
  else console.log('\nTOTAL ' + bad + ' collisions (' + THEME + ')');

  ws.close(); proc.kill(); server.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
