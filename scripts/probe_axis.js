/* Axis probe for the sensitivity line chart (c6).
 * The y-scale is normalised on the data range, which here is entirely negative.
 * A scale whose ticks run past the data (e.g. up to a positive value) wastes
 * vertical space and crowds the lowest labels into each other, so this checks
 * the tick span actually brackets the data instead of just "some ticks exist".
 * Run: node scripts/probe_axis.js [theme] [width]
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const THEME = process.argv[2] || 'light';
const WIDTH = parseInt(process.argv[3] || '1440', 10);
const PORT = 8750 + Math.floor(Math.random() * 120);
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404); res.end('nope'); return;
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
  var box = document.getElementById('chartSens');
  if (!box) return {error:'no #chartSens'};
  var svg = box.querySelector('svg');
  if (!svg) return {error:'no svg in #chartSens'};
  var vb = (svg.getAttribute('viewBox')||'').split(/\\s+/).map(Number);
  var out = {viewBox: svg.getAttribute('viewBox'), px: svg.getBoundingClientRect().width,
             yTicks: [], xTicks: [], lines: 0, dots: 0};
  var texts = svg.querySelectorAll('text');
  for (var i=0;i<texts.length;i++){
    var t = texts[i];
    var r = t.getBoundingClientRect();
    var anchor = t.getAttribute('text-anchor') || 'start';
    var txt = (t.textContent||'').trim();
    var o = {txt: txt, x: +(r.x - svg.getBoundingClientRect().x).toFixed(1),
             y: +(r.y - svg.getBoundingClientRect().y).toFixed(1),
             w: +r.width.toFixed(1), h: +r.height.toFixed(1), anchor: anchor};
    if (/\\$/.test(txt) && /k|M/.test(txt)) out.yTicks.push(o);
    else if (/%$/.test(txt)) out.xTicks.push(o);
  }
  out.lines = svg.querySelectorAll('line').length;
  out.dots = svg.querySelectorAll('circle').length;
  /* find tick lines (horizontal grid lines) to locate the plot box */
  out.hLines = [];
  var lines = svg.querySelectorAll('line');
  for (var j=0;j<lines.length;j++){
    var l = lines[j];
    var y1 = parseFloat(l.getAttribute('y1')), y2 = parseFloat(l.getAttribute('y2'));
    if (Math.abs(y1-y2) < 0.5) out.hLines.push(+(y1||0).toFixed(1));
  }
  return out;
})()`;

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const url = `http://127.0.0.1:${PORT}/index.html`;

  const chrome = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.CHROME_PATH
  ].filter(Boolean).find(p => fs.existsSync(p)) || 'chrome';

  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=0',
    `--window-size=${Math.max(WIDTH, 400)},1100`,
    '--user-data-dir=' + path.join(ROOT, 'qa', '.chrome-axis'), 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('no devtools endpoint')), 20000);
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
  await cdp(ws, 'Page.navigate', { url }, sessionId);
  await new Promise(r => setTimeout(r, 3000));
  await cdp(ws, 'Runtime.evaluate', {
    expression: `try{localStorage.setItem('bmcm-theme','${THEME}');}catch(e){}; location.reload();`
  }, sessionId);
  await new Promise(r => setTimeout(r, 3000));

  const { result } = await cdp(ws, 'Runtime.evaluate', {
    expression: PROBE, returnByValue: true
  }, sessionId);
  const v = result.value;
  if (!v || v.error) { console.error('PROBE FAILED', v); process.exit(1); }

  console.log('theme=' + THEME + '  width=' + WIDTH + '  viewBox=' + v.viewBox);
  console.log('svg px width=' + v.px.toFixed(1));
  console.log('\n-- y ticks (' + v.yTicks.length + ') --');
  v.yTicks.forEach(t => console.log('   "' + t.txt.padEnd(7) + '" x=' + String(t.x).padStart(7)
    + ' y=' + String(t.y).padStart(7) + ' h=' + t.h + ' anchor=' + t.anchor));
  console.log('\n-- x ticks (' + v.xTicks.length + ') --');
  v.xTicks.forEach(t => console.log('   "' + t.txt.padEnd(7) + '" x=' + String(t.x).padStart(7)
    + ' y=' + String(t.y).padStart(7)));
  console.log('\nhLines y=', v.hLines.join(', '));
  console.log('total lines=' + v.lines + ' dots=' + v.dots);

  /* --- overlap detection among y-tick labels --- */
  const ys = v.yTicks.slice().sort((a, b) => a.y - b.y);
  const clashes = [];
  for (let i = 1; i < ys.length; i++) {
    const prevBottom = ys[i - 1].y + ys[i - 1].h;
    if (ys[i].y < prevBottom - 0.5) clashes.push(ys[i - 1].txt + ' vs ' + ys[i].txt);
  }
  console.log('\n== y-label overlap ==');
  console.log(clashes.length ? '   CLASH: ' + clashes.join(' | ') : '   none');

  /* --- are x tick labels inside the plot box? --- */
  if (v.hLines.length) {
    const plotBottom = Math.max(...v.hLines);
    const outside = v.xTicks.filter(t => t.y < plotBottom);
    console.log('== x-label placement ==');
    console.log('   plot bottom y=' + plotBottom);
    console.log(outside.length
      ? '   INSIDE PLOT (should be below): ' + outside.map(t => t.txt).join(', ')
      : '   all x labels below the plot box');
  }

  ws.close(); proc.kill(); server.close();
  process.exit(clashes.length ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
