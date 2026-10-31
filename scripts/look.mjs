// Headless Chrome screenshots of the built app at fixed camera positions (no moves).
// Run `npm run build && npx vite preview --port 4173` first.
// Usage: node scripts/look.mjs <tier> <out.png> [x,y,z] [<out2.png> x,y,z ...]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [tier = 'high', ...shots] = process.argv.slice(2);
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--remote-debugging-port=9334', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800', '--user-data-dir=/tmp/chs-look', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(5000);
const page = (await (await fetch('http://127.0.0.1:9334/json')).json()).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pend = new Map();
const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  else if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
  else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
for (let i = 0; i < shots.length; i++) {
  const out = shots[i];
  const cam = shots[i + 1] && /^-?[\d.]+,/.test(shots[i + 1]) ? shots[++i] : null;
  await send('Page.navigate', { url: `http://localhost:4173/?tier=${tier}${cam ? `&cam=${cam}` : ''}` });
  await sleep(Number(process.env.LOOK_WAIT ?? 14000));
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(r.result.data, 'base64'));
  const hud = (await send('Runtime.evaluate', { expression: 'document.getElementById("hud")?.textContent' })).result.result.value;
  console.log(out, cam ?? 'default', '|', hud);
}
console.log('console:', logs.slice(0, 20));
ws.close();
chrome.kill();
