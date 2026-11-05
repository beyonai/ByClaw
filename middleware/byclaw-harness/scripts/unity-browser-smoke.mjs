import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '/opt/nvm/current/lib/node_modules/playwright/index.mjs';
const run = promisify(execFile);
const output = process.argv[2] || '/out';
const hubHome = join(homedir(), '.config/unityhub');
let existingHome = false;
try { await access(hubHome); existingHome = true; } catch {}
if (existingHome) throw new Error('Run this acceptance check in an isolated image with a fresh writable home');
const desktop = spawn('/usr/local/bin/unity-desktop', [], { stdio: 'inherit' });
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { ready = (await fetch('http://127.0.0.1:8083/')).ok; } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error('Unity desktop viewer did not become ready');
  const help = await run('/usr/local/bin/unity-agent', ['--help']);
  await writeFile(`${output}/unity-agent-help.log`, help.stdout + help.stderr);
  const version = await run('/opt/unity/Editor/Unity', ['-version'], { timeout: 30000, env: { ...process.env, DISPLAY: ':1' } });
  await writeFile(`${output}/editor-version.log`, version.stdout + version.stderr);
  if (!(version.stdout + version.stderr).includes('2022.3.62f3c1')) throw new Error('Unity version mismatch');
  await writeFile('/tmp/byclaw-wasm.c', 'int byclaw_add(int a, int b) { return a + b; }\n');
  const clang = '/opt/unity/Editor/Data/PlaybackEngines/WebGLSupport/BuildTools/Emscripten/llvm/clang';
  const optimizer = '/opt/unity/Editor/Data/PlaybackEngines/WebGLSupport/BuildTools/Emscripten/binaryen/bin/wasm-opt';
  await run(clang, ['--target=wasm32', '-O2', '-nostdlib', '-Wl,--no-entry', '-Wl,--export=byclaw_add', '/tmp/byclaw-wasm.c', '-o', '/tmp/byclaw.wasm']);
  await run(optimizer, ['-O1', '/tmp/byclaw.wasm', '-o', '/tmp/byclaw-opt.wasm']);
  const wasm = await WebAssembly.instantiate(await readFile('/tmp/byclaw-opt.wasm'));
  if (wasm.instance.exports.byclaw_add(20, 22) !== 42) throw new Error('Bundled WebGL compiler/optimizer execution failed');
  await writeFile(`${output}/webgl-toolchain.log`, 'Bundled clang compiled wasm32; wasm-opt optimized it; WebAssembly executed add(20,22)=42. Full Unity scene export still requires an owner license.\n');
  let windows;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { windows = await run('xdotool', ['search', '--onlyvisible', '--name', 'Unity Hub', 'getwindowname'], { env: { ...process.env, DISPLAY: ':1' } }); } catch {}
    if (windows?.stdout.includes('Unity Hub')) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!windows?.stdout.includes('Unity Hub')) throw new Error('Visible Unity Hub window not found');
  await writeFile(`${output}/hub-window.log`, windows.stdout);
  const hubLog = await readFile(join(hubHome, 'logs/info-log.json'), 'utf8');
  if (hubLog.includes("Couldn't find a valid ICU package")) throw new Error('Unity Hub licensing client cannot load ICU');
  if (!hubLog.includes('LicensingSdkService')) throw new Error('Unity Hub licensing client startup was not observed');
  await writeFile(`${output}/licensing-client-check.log`, 'Fresh-home Unity Hub window visible; licensing client initialized without missing-ICU errors. No license activation or project export was performed.\n');
  browser = await chromium.launch({ executablePath: '/usr/local/bin/byclaw-playwright-chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://127.0.0.1:8083/vnc.html?autoconnect=1&resize=scale&path=websockify');
  await page.waitForFunction(() => document.documentElement.classList.contains('noVNC_connected'));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${output}/hub-desktop.png` });
  console.log('BYCLAW_UNITY_EDITOR_VERSION_HUB_DESKTOP_SMOKE_OK');
} finally {
  if (browser) await browser.close();
  desktop.kill('SIGTERM');
}
