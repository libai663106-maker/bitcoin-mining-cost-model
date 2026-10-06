/* High-DPI single-element shot: node scripts/shot_one.js <selector> <scale> <out>
 * Useful for judging label collision / font legibility at native resolution —
 * the segmented page shots get downscaled and hide small overlaps.
 * Env: THEME=light|dark|tech|minimal, W=<viewport px>,
 *      LANG_OVERRIDE=zh-CN|zh-TW|en (locale, see below),
 *      PROFILE=<chrome profile dir under qa/>,
 *      EVAL=<js to run before measuring> — e.g. to un-clamp a scroll box so a
 *      50-row table can be captured whole instead of only its first screen.
 */
const http = require('http'), path = require('path'), fs = require('fs');
const { spawn } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.resolve(__dirname, '..');
const SEL = process.argv[2] || '.chartbox';
const SCALE = Number(process.argv[3]) || 2;
const OUT = process.argv[4] || 'one.png';
const PORT = 9600 + Math.floor(Math.random() * 200);
const THEME = process.env.THEME || 'light';
const W = Number(process.env.W) || 1440;
const LANG = process.env.LANG_OVERRIDE || process.env.LANG || '';
const PRE = process.env.EVAL || '';

/* The locale goes in the URL, exactly as audit.js does it. Writing
   localStorage['bmcm-lang'] instead is a trap: the app resolves its locale
   once, at boot, so a write made AFTER navigation is only read by the NEXT
   page load — the shot you asked for comes out in whatever language the
   profile last remembered, and the one after it comes out in the language you
   just asked for. That one-run lag looks exactly like "the translations are
   missing from this chart". */
const FILE = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/')
  + (LANG ? '?lang=' + encodeURIComponent(LANG) : '');

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
    if (m.id && w.has(m.id)) {
      const x = w.get(m.id); w.delete(m.id);
      m.error ? x.reject(new Error(JSON.stringify(m.error))) : x.resolve(m.result);
    }
  });
  ws.addEventListener('open', () => res({
    send: (method, params) => new Promise((resolve, reject) => {
      const i = ++id; w.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    }),
    close: () => ws.close()
  }));
  ws.addEventListener('error', rej);
});

(async () => {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(ROOT, 'qa', process.env.PROFILE || 'profile-one'),
    '--window-size=' + W + ',900', FILE
  ], { stdio: 'ignore' });

  let cdp, list;
  for (let i = 0; i < 60; i++) {
    try {
      list = await getJson('/json/list');
      cdp = await connect(list.find(t => t.type === 'page').webSocketDebuggerUrl);
      break;
    } catch (e) { await new Promise(r => setTimeout(r, 250)); }
  }
  if (!cdp) { chrome.kill(); throw new Error('no attach'); }

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: 900, deviceScaleFactor: 1, mobile: W < 500 });
  await cdp.send('Page.navigate', { url: FILE });
  await new Promise(r => setTimeout(r, 3000));

  const ev = async e => (await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;

  /* Theme is applied by hand (it has no URL channel); the locale is NOT written
     to localStorage here on purpose — see the note on FILE above.
     The token cache is dropped for the same reason the app drops it in
     applyTheme(): charts.js resolves every colour through AppData.tok(), which
     memoises on first read. The page boots in whatever theme the profile
     remembers (light), so without this the shot comes out with dark chrome and
     the LIGHT chart palette — a hybrid no user ever sees. The tell: two themes
     with different palettes render identical series colours. */
  await ev("localStorage.setItem('bmcm-theme','" + THEME + "');"
    + "document.documentElement.setAttribute('data-theme','" + THEME + "');"
    + "window.AppData&&window.AppData.dropTokCache();"
    + "window.__model&&window.__model.render();");
  await ev("document.querySelectorAll('.drawer').forEach(function(d){d.classList.remove('on')});");
  await new Promise(r => setTimeout(r, 700));
  if (PRE) { await ev(PRE); await new Promise(r => setTimeout(r, 400)); }

  const selJson = JSON.stringify(SEL);
  const box = await ev("(function(){var e=document.querySelector(" + selJson + ");if(!e)return null;var r=e.getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,w:r.width,h:r.height};})()");
  if (!box) { console.error('selector not found: ' + SEL); chrome.kill(); process.exit(1); }

  const r = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: SCALE },
    captureBeyondViewport: true
  });
  fs.writeFileSync(path.join(ROOT, 'qa', OUT), Buffer.from(r.data, 'base64'));
  console.log('wrote qa/' + OUT + '  css=' + Math.round(box.w) + 'x' + Math.round(box.h) + '  x' + SCALE);
  cdp.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
