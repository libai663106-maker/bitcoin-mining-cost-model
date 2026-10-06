/* Segmented screenshots via CDP — avoids the tall-window layout distortion.
 * Usage: node scripts/shots.js <theme> [width]
 */
const http = require('http'), path = require('path'), fs = require('fs');
const { spawn } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.resolve(__dirname, '..');
const FILE = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const THEME = process.argv[2] || 'light';
const WIDTH = Number(process.argv[3]) || 1440;
const PORT = 9400 + Math.floor(Math.random() * 200);
const OUT = path.join(ROOT, 'qa');

function getJson(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}
function connect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url); let id = 0; const waiting = new Map();
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.error ? w.reject(new Error(JSON.stringify(m.error))) : w.resolve(m.result); }
    });
    ws.addEventListener('open', () => res({
      send: (method, params) => new Promise((resolve, reject) => {
        const mid = ++id; waiting.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
      }), close: () => ws.close()
    }));
    ws.addEventListener('error', rej);
  });
}

(async () => {
  const profile = path.join(OUT, 'profile');
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--window-size=' + WIDTH + ',900', FILE
  ], { stdio: 'ignore' });

  let cdp, list;
  for (let i = 0; i < 60; i++) {
    try { list = await getJson('/json/list'); cdp = await connect(list.find(t => t.type === 'page').webSocketDebuggerUrl); break; }
    catch (e) { await new Promise(r => setTimeout(r, 250)); }
  }
  if (!cdp) { chrome.kill(); throw new Error('no attach'); }

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: WIDTH < 500 });
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await cdp.send('Page.navigate', { url: FILE });
  await new Promise(r => setTimeout(r, 3000));

  const ev = async expr => (await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

  /* Drop the memoised token cache alongside the theme — the app does it in
     applyTheme(), and without it the charts keep the boot theme's palette. */
  await ev(`localStorage.setItem('bmcm-theme','${THEME}');document.documentElement.setAttribute('data-theme','${THEME}');window.AppData&&window.AppData.dropTokCache();window.__model&&window.__model.render();`);
  await ev(`document.querySelectorAll('.drawer').forEach(function(d){d.classList.remove('on')});`);
  if (process.env.HIDE_CHARTS) await ev(`document.querySelectorAll('.chartbox').forEach(function(d){d.style.display='none'});`);
  await new Promise(r => setTimeout(r, 800));

  /* DUMP=1 → print every chart's viewBox + first text runs, to verify label
     geometry without eyeballing a PNG. */
  if (process.env.DUMP) {
    const dump = await ev(`(function(){
      return [].slice.call(document.querySelectorAll('.chartbox')).map(function(box,i){
        var s=box.querySelector('svg');
        if(!s) return {i:i, svg:false};
        var bb=s.getBoundingClientRect();
        return { i:i, id:s.querySelector('clipPath')?s.querySelector('clipPath').id:'-',
          vb:s.getAttribute('viewBox'), px:Math.round(bb.width)+'x'+Math.round(bb.height),
          texts:[].slice.call(s.querySelectorAll('text')).slice(0,16).map(function(t){return t.textContent}) };
      });
    })()`);
    console.log(JSON.stringify(dump, null, 1));
  }

  /* find section boundaries by panel, then shoot each */
  const bounds = await ev(`(function(){
    var out=[];
    var main=document.querySelector('main');
    var top=main.getBoundingClientRect().top+scrollY;
    var nodes=[main.querySelector('.hero-head'), main.querySelector('.in-groups')];
    main.querySelectorAll(':scope > .sec').forEach(function(s){ nodes.push(s); });
    var hs = nodes.filter(Boolean).map(function(n){
      var r=n.getBoundingClientRect();
      return { y: Math.round(r.top+scrollY), h: Math.round(r.height) };
    });
    /* merge anything shorter than 40px */
    var merged=[]; hs.forEach(function(x){ if(x.h<40) return; merged.push(x); });
    /* group into <=780px bites, cutting at node boundaries */
    var shots=[], cur=null;
    merged.forEach(function(x){
      if(!cur){ cur={y:x.y,h:x.h}; return; }
      if(cur.h + (x.y-(cur.y+cur.h)) + x.h <= 820){ cur.h = x.y + x.h - cur.y; }
      else { shots.push(cur); cur={y:x.y,h:x.h}; }
    });
    if(cur) shots.push(cur);
    return { shots: shots, total: document.documentElement.scrollHeight };
  })()`);

  console.log('theme=' + THEME + ' width=' + WIDTH + ' totalH=' + bounds.total + ' shots=' + bounds.shots.length);
  let i = 0;
  for (const b of bounds.shots) {
    i++;
    const name = `${THEME}_${WIDTH}_${String(i).padStart(2, '0')}.png`;
    await cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: b.y, width: WIDTH, height: Math.min(b.h, 820), scale: 1 },
      captureBeyondViewport: true
    }).then(r => fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')));
    console.log('  ' + name + '  y=' + b.y + ' h=' + Math.min(b.h, 820));
  }

  cdp.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
