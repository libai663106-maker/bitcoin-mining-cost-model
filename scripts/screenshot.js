/* Headless-Chrome QA harness.
 * Usage: node scripts/screenshot.js [scenario]
 *   scenario: light | dark | tech | minimal | all | mobile | tools | a11y
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'qa');
const FILE = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');

fs.mkdirSync(OUT, { recursive: true });

const THEME_BOOT = t => `<script>
try{localStorage.setItem('bmcm-theme','${t}')}catch(e){}
location.replace(${JSON.stringify(FILE)});
</script>`;

function shot(html, name, w, h, extra) {
  const tmp = path.join(OUT, '_tmp_' + name + '.html');
  fs.writeFileSync(tmp, html, 'utf8');
  const args = [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
    '--force-device-scale-factor=1',
    '--virtual-time-budget=6000',
    '--window-size=' + w + ',' + h,
    '--screenshot=' + path.join(OUT, name + '.png'),
    'file:///' + tmp.replace(/\\/g, '/')
  ].concat(extra || []);
  const r = spawnSync(CHROME, args, { encoding: 'utf8', timeout: 90000 });
  if (r.error) throw r.error;
  const p = path.join(OUT, name + '.png');
  const size = fs.existsSync(p) ? fs.statSync(p).size : 0;
  console.log('  ' + name.padEnd(28) + w + 'x' + h + '  ' + (size / 1024).toFixed(0) + ' KB');
  return p;
}

const arg = process.argv[2] || 'all';

if (arg === 'a11y' || arg === 'all') {
  const dump = `<!doctype html><meta charset=utf-8>
<script>
(async()=>{
  const out=[];
  const log=(...a)=>out.push(a.join(' '));
  const page = document.createElement('div');
  history.replaceState(null,'','${FILE}');
  location.href='${FILE}';
})();
</script>`;
  /* real a11y/geometry dump needs the page itself; see audit.js */
}

const targets = {
  light: ['light', 1440, 3000],
  dark: ['dark', 1440, 3000],
  tech: ['tech', 1440, 3000],
  minimal: ['minimal', 1440, 3000],
  mobile: ['light', 390, 2400],
  tablet: ['dark', 820, 2400]
};

const list = arg === 'all' ? Object.keys(targets) : [arg];
console.log('Rendering with headless Chrome ->', OUT);
for (const key of list) {
  const [theme, w, h] = targets[key];
  shot(THEME_BOOT(theme), key, w, h);
}
console.log('done');
