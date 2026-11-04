// Run as byclaw in an isolated Godot container, with an output directory argument.
import { spawn, execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { chromium } from '/opt/nvm/current/lib/node_modules/playwright/index.mjs';

const output = process.argv[2];
if (!output) throw new Error('usage: node godot-browser-smoke.mjs OUTPUT_DIRECTORY');
await mkdir(output, { recursive: true });
const run = promisify(execFile);
const children = [];
let browser;
try {
  const { stdout, stderr } = await run('/usr/local/bin/byclaw-godot-business-smoke', [], {
    env: { ...process.env, BYCLAW_GODOT_SMOKE_OUTPUT: output },
    maxBuffer: 8 * 1024 * 1024,
  });
  await writeFile(`${output}/business.log`, stdout + stderr);
  children.push(spawn('/usr/local/bin/byclaw-godot-desktop', [], { stdio: 'inherit' }));
  children.push(spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1', '--directory', `${output}/web`], { stdio: 'inherit' }));
  for (const port of [8083, 8765]) {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/`)).ok; } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error(`HTTP port ${port} did not become ready`);
  }
  browser = await chromium.launch({
    executablePath: '/usr/local/bin/byclaw-playwright-chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const messages = [];
  page.on('console', (message) => messages.push(message.text()));
  page.on('pageerror', (error) => messages.push(`PAGE_ERROR: ${error.message}`));
  await page.goto('http://127.0.0.1:8765/index.html');
  for (let attempt = 0; attempt < 150 && !messages.some((message) => message.includes('BYCLAW_GODOT_SCENE_OK')); attempt++) {
    await page.waitForTimeout(200);
  }
  await writeFile(`${output}/browser-console.log`, messages.join('\n'));
  if (!messages.some((message) => message.includes('BYCLAW_GODOT_SCENE_OK'))) throw new Error('Exported Web game did not execute its scene');
  await page.locator('canvas').screenshot({ path: `${output}/web-preview.png` });
  await page.goto('http://127.0.0.1:8083/vnc.html?autoconnect=1&resize=scale&path=websockify');
  await page.waitForFunction(() => document.documentElement.classList.contains('noVNC_connected'), null, { timeout: 30000 });
  await page.waitForFunction(() => [...document.querySelectorAll('canvas')].some((canvas) => canvas.width >= 1280 && canvas.height >= 800));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${output}/editor-desktop.png` });
  const { stdout: windows } = await run('xwininfo', ['-display', ':3', '-root', '-tree']);
  await writeFile(`${output}/desktop-windows.log`, windows);
  if (!windows.includes('Godot')) throw new Error('Godot project manager/editor window not found');
  console.log('BYCLAW_GODOT_BROWSER_AND_DESKTOP_SMOKE_OK');
} finally {
  if (browser) await browser.close();
  for (const child of children) child.kill('SIGTERM');
}
