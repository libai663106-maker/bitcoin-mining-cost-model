/* Geometry probe for the sensitivity heat table.
 * Prints, per row, the x/width of every cell so column misalignment and
 * background-colour flatness are visible without eyeballing a screenshot.
 * Run: node scripts/probe_heat.js            (default light 1440, locale pinned to en)
 *      node scripts/probe_heat.js light 1440
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const THEME = process.argv[2] || 'light';
const WIDTH = parseInt(process.argv[3] || '1440', 10);
const PORT = 8792 + Math.floor(Math.random() * 200);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2'
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

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  /* Locale pinned, like every other probe here. The corner cell names both axes
     and its text length sets the first column's width, so an inherited locale
     from the shared Chrome profile would silently change the geometry this
     probe is meant to report — the run before this one came out Chinese. */
  const url = `http://127.0.0.1:${PORT}/index.html?lang=en`;

  const chrome = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.CHROME_PATH
  ].filter(Boolean).find(p => fs.existsSync(p)) || 'chrome';

  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=0',
    `--window-size=${Math.max(WIDTH, 400)},1100`,
    '--user-data-dir=' + path.join(ROOT, 'qa', '.chrome-heat'),
    'about:blank'
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

  const WS = global.WebSocket;
  const ws = new WS(wsUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));

  const { targetId } = await cdp(ws, 'Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: true });
  await cdp(ws, 'Page.enable', {}, sessionId);
  await cdp(ws, 'Runtime.enable', {}, sessionId);

  await cdp(ws, 'Page.navigate', { url }, sessionId);
  await new Promise(r => setTimeout(r, 2500));

  await cdp(ws, 'Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: 1100, deviceScaleFactor: 1, mobile: false
  }, sessionId);
  await cdp(ws, 'Runtime.evaluate', {
    expression: `try{localStorage.setItem('bmcm-theme','${THEME}');}catch(e){}; location.reload();`
  }, sessionId);
  await new Promise(r => setTimeout(r, 2500));

  const expr = `(function(){
    var t = document.getElementById('heat');
    if (!t) return {error:'no #heat'};
    function box(el){ var r = el.getBoundingClientRect(); return {x:+r.x.toFixed(1), w:+r.width.toFixed(1)}; }
    var out = {theme:document.documentElement.getAttribute('data-theme'), rows:[]};
    var trs = t.querySelectorAll('tr');
    for (var i=0;i<trs.length;i++){
      var cells = trs[i].querySelectorAll('th,td');
      var row = [];
      for (var j=0;j<cells.length;j++){
        var c = cells[j];
        var o = box(c);
        o.tag = c.tagName;
        o.cls = c.className;
        o.txt = (c.textContent||'').slice(0,18);
        o.bg = getComputedStyle(c).backgroundColor;
        row.push(o);
      }
      out.rows.push(row);
    }
    return out;
  })()`;

  const { result } = await cdp(ws, 'Runtime.evaluate', {
    expression: expr, returnByValue: true
  }, sessionId);

  if (!result.value || result.value.error) {
    console.error('PROBE FAILED', result.value);
  } else {
    const v = result.value;
    console.log('theme=' + v.theme + '  width=' + WIDTH);
    v.rows.forEach((row, ri) => {
      console.log('\n-- row ' + ri + ' --');
      row.forEach(c => {
        console.log('   ' + c.tag.padEnd(3) + ' x=' + String(c.x).padStart(7)
          + ' w=' + String(c.w).padStart(6)
          + '  ' + c.bg.padEnd(26) + ' "' + c.txt + '"'
          + (c.cls ? '  .' + c.cls.split(' ').join('.') : ''));
      });
    });

    /* column-axis check: does cell j line up with header j? */
    if (v.rows.length >= 2) {
      const head = v.rows[0], body = v.rows[1];
      if (head.length === body.length) {
        console.log('\n== column alignment (header vs first body row) ==');
        head.forEach((h, i) => {
          const d = Math.abs(h.x - body[i].x);
          console.log('   col ' + i + '  dx=' + d.toFixed(1) + (d > 1.5 ? '   <-- MISALIGNED' : ''));
        });
      } else {
        console.log('\n!! header has ' + head.length + ' cells, body row has ' + body.length);
      }
    }
  }

  ws.close();
  proc.kill();
  server.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
