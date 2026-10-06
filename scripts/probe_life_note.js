/* One-off probe: does the "{n}" static note (vs.spotNote / ch1.hint) follow
 * 使用年限 when the user changes it — or does it stay stale at 4?
 * Usage: node scripts/probe_life_note.js
 */
const http = require('http'), path = require('path');
const { spawn } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.resolve(__dirname, '..');
const FILE = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') + '?lang=zh-CN';
const PORT = 9700 + Math.floor(Math.random() * 80);

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

(async () => {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(ROOT, 'qa', 'profile-life'),
    '--window-size=1440,1000', FILE
  ], { stdio: 'ignore' });

  let cdp;
  for (let i = 0; i < 60; i++) { try { cdp = await connect((await getJson('/json/list')).find(t => t.type === 'page').webSocketDebuggerUrl); break; } catch (e) { await new Promise(r => setTimeout(r, 250)); } }
  if (!cdp) { chrome.kill(); throw new Error('no attach'); }

  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: FILE });
  await new Promise(r => setTimeout(r, 3200));

  const ev = async e => {
    const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception || {}).description);
    return r.result.value;
  };

  const read = () => ev(`(function(){
    function note(key){
      var el = document.querySelector('[data-i18n="' + key + '"]');
      return el ? el.textContent.trim() : null;
    }
    return {
      lifeInput: (document.querySelector('[data-k="lifeYears"]') || {}).value || null,
      spotNote: note('vs.spotNote'),
      ch1Hint: note('ch1.hint'),
      vsRatio: (document.getElementById('vsRatio') || {}).textContent || null,
      vsSpot: (document.getElementById('vsSpot') || {}).textContent || null,
      monthsInModel: window.__model && window.__model.state && window.__model.state.result
        ? window.__model.state.result.input.months : null
    };
  })()`);

  console.log('--- 初始（默认 4 年） ---');
  console.log(JSON.stringify(await read(), null, 1));

  /* Drive the real input: set lifeYears = 10 and fire the same event the
     number input's listener binds. */
  await ev(`(function(){
    var el = document.querySelector('[data-k="lifeYears"]');
    el.value = '10';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await new Promise(r => setTimeout(r, 600));

  console.log('--- 改成 10 年之后 ---');
  console.log(JSON.stringify(await read(), null, 1));

  cdp.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
