/* Focused assertions for the sensitivity heat matrix.
 * Covers the two defects found in review:
 *   - the diverging colour ramp must stay informative when every cell shares a sign
 *   - the corner axis label must align with the data block, not float left
 * Run: node scripts/test_heat.js
 *      node scripts/test_heat.js dark     (pin a theme; default = stored theme)
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const THEME = process.argv[2] || '';
const PORT = 8850 + Math.floor(Math.random() * 120);
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml'
};

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '   -> ' + JSON.stringify(extra) : '')); }
}

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
  var t = document.getElementById('heat');
  if (!t) return {error:'no #heat'};
  function rect(el){ var r = el.getBoundingClientRect(); return {x:r.x, w:r.width, r:r.right}; }
  /* Channel triple, so a cell's colour family can be compared against the
     token it claims to come from. Chrome serialises these two ways depending on
     the token syntax: "color(srgb 0.86 0.15 0.15 / 0.23)" for an alpha-composited
     colour and "rgb(220, 38, 38)" for a plain one. */
  function triple(css){
    var s = String(css);
    var m = s.match(/color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)/);
    if (m) return [Math.round(+m[1]*255), Math.round(+m[2]*255), Math.round(+m[3]*255)];
    m = s.match(/rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)/);
    return m ? [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])] : null;
  }
  /* Resolve a design token to an rgb triple through a throwaway element —
     comparing against the raw token string would mean re-implementing CSS
     colour parsing in the assertion. */
  function chan(name){
    var d = document.createElement('span');
    d.style.display = 'none';
    d.style.color = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    document.body.appendChild(d);
    var v = getComputedStyle(d).color;
    d.parentNode.removeChild(d);
    return triple(v);
  }
  var trs = t.querySelectorAll('tr');
  var rows = [];
  for (var i=0;i<trs.length;i++){
    var cells = trs[i].querySelectorAll('th,td');
    var row = [];
    for (var j=0;j<cells.length;j++){
      var c = cells[j];
      var o = rect(c);
      o.tag = c.tagName;
      o.cls = c.className;
      o.txt = (c.textContent||'').trim();
      o.bg = getComputedStyle(c).backgroundColor;
      o.rgb = triple(o.bg);
      o.align = getComputedStyle(c).textAlign;
      row.push(o);
    }
    rows.push(row);
  }
  var s = document.getElementById('heatScale');
  return {
    rows: rows,
    negRgb: chan('--chart-neg'),
    posRgb: chan('--chart-pos'),
    scaleText: s ? (s.textContent||'').trim() : null,
    scaleVisible: s ? getComputedStyle(s).display !== 'none' : false,
    theme: document.documentElement.getAttribute('data-theme')
  };
})()`;

/* Pull the alpha channel out of "color(srgb r g b / a)" or "rgba(r,g,b,a)". */
function alphaOf(bg) {
  let m = bg.match(/\/\s*([\d.]+)\s*\)/);
  if (m) return parseFloat(m[1]);
  m = bg.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)/);
  if (m) return parseFloat(m[1]);
  return bg === 'rgba(0, 0, 0, 0)' ? -1 : 1;
}

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  /* Pin the locale. The assertions below read English copy, and the shared
     Chrome profile can carry a saved bmcm-lang from an earlier run — which
     would make this suite fail on translation text rather than on heat-map
     geometry. The URL param is the highest-precedence source, so it wins. */
  const url = `http://127.0.0.1:${PORT}/index.html?lang=en`;

  const chrome = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.CHROME_PATH
  ].filter(Boolean).find(p => fs.existsSync(p)) || 'chrome';

  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=0', '--window-size=1440,1100',
    '--user-data-dir=' + path.join(ROOT, 'qa', '.chrome-heat-test'),
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

  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));

  const { targetId } = await cdp(ws, 'Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: true });
  await cdp(ws, 'Page.enable', {}, sessionId);
  await cdp(ws, 'Runtime.enable', {}, sessionId);
  await cdp(ws, 'Page.navigate', { url }, sessionId);
  await new Promise(r => setTimeout(r, 3000));

  if (THEME) {
    await cdp(ws, 'Runtime.evaluate', {
      expression: `try{localStorage.setItem('bmcm-theme','${THEME}');}catch(e){}; location.reload();`
    }, sessionId);
    await new Promise(r => setTimeout(r, 3000));
  }

  const grab = async () => {
    const { result } = await cdp(ws, 'Runtime.evaluate', {
      expression: PROBE, returnByValue: true
    }, sessionId);
    return result.value;
  };

  const v = await grab();

  /* The axis ladder is the spec, so it is stated once — as rendered text, which
     is what the reader actually sees. Every count and index below is derived
     from it, so widening the ladder is a one-line change here rather than a
     hunt for the half-dozen places that used to spell "4x3". */
  const AXIS = ['0%', '10%', '20%', '30%', '40%', '50%'];

  console.log('\n== structure ==');
  ok('heat table rendered', v && !v.error, v);
  if (!v || v.error) { finish(); return; }
  if (THEME) ok('theme pinned to ' + THEME, v.theme === THEME, v.theme);

  const colHeads = v.rows[0].slice(1).map(c => c.txt);
  const rowHeads = v.rows.slice(1).map(r => r[0].txt);
  ok('column headers are the hashrate ladder (right axis →)',
    JSON.stringify(colHeads) === JSON.stringify(AXIS), colHeads);
  ok('row headers are the BTC ladder (down axis ↓)',
    JSON.stringify(rowHeads) === JSON.stringify(AXIS), rowHeads);
  ok('header + one body row per BTC rung', v.rows.length === AXIS.length + 1, v.rows.length);
  ok('header row = corner + one cell per hashrate rung',
    v.rows[0].length === AXIS.length + 1, v.rows[0].length);
  ok('every body row = header + one cell per hashrate rung',
    v.rows.slice(1).every(r => r.length === AXIS.length + 1),
    v.rows.slice(1).map(r => r.length));

  console.log('\n== column alignment ==');
  const head = v.rows[0];
  v.rows.slice(1).forEach((r, ri) => {
    const bad = head.map((h, i) => Math.abs(h.x - r[i].x) > 1.5 ? i : -1).filter(i => i >= 0);
    ok('row ' + ri + ' columns align to header', bad.length === 0, bad);
  });

  console.log('\n== diverging colour ramp ==');
  const bodyCells = [];
  v.rows.slice(1).forEach(r => r.slice(1).forEach(c => bodyCells.push(c)));
  ok(AXIS.length * AXIS.length + ' data cells', bodyCells.length === AXIS.length * AXIS.length,
    bodyCells.length);

  const alphas = bodyCells.map(c => alphaOf(c.bg));
  ok('every cell has a non-transparent background', alphas.every(a => a > 0.05), alphas);
  const aMin = Math.min(...alphas), aMax = Math.max(...alphas);
  ok('ramp spans a readable range (aMax - aMin > 0.25)', (aMax - aMin) > 0.25,
    { min: aMin, max: aMax, span: +(aMax - aMin).toFixed(3) });

  const nums = bodyCells.map(c => parseFloat(c.txt.replace(/[$,]/g, '')));
  ok('all cell values parsed', nums.every(n => isFinite(n)), nums);

  /* The ramp is normalised per sign, so "darker = worse" holds only *inside* a
     sign class. Two things changed here at once: the ladder now runs to +50%
     hashrate growth (the losing corner deepens) and to +50% BTC growth (a
     profitable corner appears), so the grid straddles zero and the old
     single-sign assertions — "darkest == most negative", "shade deepens left to
     right" — stopped describing the contract. They were never the contract;
     they were a property of the old 0–15% grid. What must hold for any sign mix
     is: depth tracks |value| within a sign, the colour family tracks the sign,
     and each sign's own extreme takes the deepest shade. */
  const negCells = [], posCells = [];
  bodyCells.forEach((c, i) => (nums[i] < 0 ? negCells : posCells).push({ v: nums[i], a: alphas[i], rgb: c.rgb, i: i }));
  ok('the ladder exercises a losing corner and a profitable one',
    negCells.length > 0 && posCells.length > 0, { neg: negCells.length, pos: posCells.length });

  function byMagnitude(cells) { return cells.slice().sort((x, y) => Math.abs(x.v) - Math.abs(y.v)); }
  function shadeTracks(label, cells) {
    const s = byMagnitude(cells);
    ok(label, s.every((p, i) => i === 0 || p.a >= s[i - 1].a - 1e-9),
      s.map(p => [+p.v.toFixed(0), +p.a.toFixed(2)]));
  }
  shadeTracks('shade deepens with loss size', negCells);
  shadeTracks('shade deepens with gain size', posCells);

  /* Each side is normalised against its own extreme, so both extremes land on
     the deepest shade. That is a deliberate choice (a shared scale collapses the
     sign that happens to be smaller), and it is also why the legend has to say
     "red = losing, green = profitable" rather than relying on depth alone. */
  ok('worst loss and best gain both take the deepest shade',
    Math.max(...negCells.map(c => c.a)) === Math.max(...posCells.map(c => c.a)),
    { neg: Math.max(...negCells.map(c => c.a)), pos: Math.max(...posCells.map(c => c.a)) });

  /* Colour family follows the sign. Without this the per-sign ramp is
     unfalsifiable: any two shades would "look like a ramp". */
  const key = t => JSON.stringify(t);
  ok('every losing cell is drawn in --chart-neg',
    negCells.every(c => key(c.rgb) === key(v.negRgb)),
    { token: v.negRgb, used: [...new Set(negCells.map(c => key(c.rgb)))] });
  ok('every profitable cell is drawn in --chart-pos',
    posCells.every(c => key(c.rgb) === key(v.posRgb)),
    { token: v.posRgb, used: [...new Set(posCells.map(c => key(c.rgb)))] });
  ok('the two families are different colours', key(v.negRgb) !== key(v.posRgb),
    { neg: v.negRgb, pos: v.posRgb });

  /* Every cell distinct enough to tell neighbours apart */
  const uniq = new Set(alphas.map(a => a.toFixed(2)));
  ok('cells are distinguishable (>= 6 distinct shades)', uniq.size >= 6, uniq.size);

  console.log('\n== axis labels ==');
  const corner = v.rows[0][0];
  ok('corner label present', /BTC growth/i.test(corner.txt), corner.txt);
  ok('corner label is right-aligned to the data edge', corner.align === 'right', corner.align);
  ok('column headers are centred', v.rows[0].slice(1).every(c => c.align === 'center'),
    v.rows[0].slice(1).map(c => c.align));
  ok('row headers name the BTC growth axis', v.rows.slice(1).every(r => /%/.test(r[0].txt)),
    v.rows.slice(1).map(r => r[0].txt));

  const cornerGap = v.rows[0][1].x - (corner.x + corner.w);
  ok('corner label sits within 20px of first data column', Math.abs(cornerGap) < 20,
    +cornerGap.toFixed(1));

  console.log('\n== scale legend ==');
  ok('scale legend has text', v.scaleText && v.scaleText.length > 20, v.scaleText);
  ok('scale legend is visible', v.scaleVisible === true);
  /* The legend has to describe the grid in front of the reader. With the ladder
     now spanning both signs, the single-sign wording ("every cell loses money")
     would be a false statement about the table — so the assertion names both
     colours, which is the branch this grid actually takes. */
  ok('legend explains losing and profitable cells together',
    /losing/i.test(v.scaleText || '') && /profitable/i.test(v.scaleText || ''),
    v.scaleText);

  finish();

  function finish() {
    console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILED') + '  ' + pass + ' passed / ' + fail + ' failed');
    ws.close(); proc.kill(); server.close();
    process.exit(fail === 0 ? 0 : 1);
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
