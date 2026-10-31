// Headless Chrome smoke test: loads the built app (run `npm run build && npx vite preview --port 4173` first),
// presses Space 3x + clicks once (4 demo moves), prints the HUD and writes a screenshot.
// Usage: node scripts/smoke.mjs [off|low|high] [out.png]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const chrome = spawn('google-chrome', ['--headless=new','--no-sandbox','--remote-debugging-port=9333','--use-angle=swiftshader','--enable-unsafe-swiftshader','--window-size=1280,800','--user-data-dir=/tmp/chs-prof','about:blank'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 6000));
const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(); const logs = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' ')); else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + JSON.stringify(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
const shot = async (path) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path, Buffer.from(r.result.data, 'base64')); };
const hud = async () => (await send('Runtime.evaluate', { expression: 'document.getElementById("hud").textContent' })).result.result.value;
await send('Page.navigate', { url: (process.env.SMOKE_URL ?? 'http://localhost:4173/') + '?tier=' + (process.argv[2] ?? 'high') });
await sleep(9000);
console.log('HUD before:', await hud());
for (let i = 0; i < 3; i++) { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space' }); await sleep(800); }
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 400, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 400, button: 'left', clickCount: 1 });
await sleep(3000);
console.log('HUD after:', await hud());
await shot(process.argv[3] ?? '/workspace/chess3d/smoke.png');
console.log('console:', logs.slice(0, 20));
ws.close(); chrome.kill();
