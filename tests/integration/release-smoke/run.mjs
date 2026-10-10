import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, validateConfig, validateNotification, notificationTargets, safeText } from './config.mjs';
import { waitReady } from './helpers/readiness.mjs';
import { outcome, renderText, saveSummary } from './report/summary.mjs';
import { notify } from './report/dingtalk.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const help = `Usage: sh scripts/run-release-smoke.sh --env <name> --base-url <chat-url> --user <user-code> [--version <version>] [--require-version] [--result-dir <empty-dir>] [--no-notify]
Credentials: BYCLAW_SMOKE_PASSWORD (or E2E_ADMIN_PASS)
Configuration: BYCLAW_SMOKE_CONFIG_FILE; notification config: BYCLAW_SMOKE_NOTIFY_CONFIG
Install once: cd tests/integration/release-smoke && pnpm install --frozen-lockfile && pnpm run install:browser
Resend an existing report: --notify-only <completed-run-dir>
--no-notify is for local debugging only; automatic deployment runs always notify.`;

async function main() {
  let config;
  try { config = loadConfig(process.argv.slice(2)); }
  catch { console.error('参数或超时配置无效；使用 --help 查看用法'); return 2; }
  if (config.help) { console.log(help); return 0; }
  if (config.notifyOnly) {
    try {
      validateNotification(config);
      const dir = path.resolve(config.notifyOnly);
      const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
      if (!summary.finishedAt) throw new Error('该报告尚未结束，不能重发');
      summary.notification = await notify(config, renderText(summary, false));
      saveSummary(dir, summary);
      console.log(`群通知：${summary.notification.status}`);
      for (const target of summary.notification.targets || []) console.log(`${target.name}：${target.status}`);
      if (summary.notification.reason) console.log(summary.notification.reason);
      return summary.notification.status === 'sent' ? 0 : 1;
    } catch (error) { console.error(safeText(error.message, config)); return 2; }
  }
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const dir = path.resolve(config.resultDir || path.join(root, 'results', runId));
  // Never overwrite a previous run or delete its artifacts.
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) { console.error('结果目录必须为空，请为本轮指定独立目录'); return 2; }
  fs.mkdirSync(path.join(dir, 'artifacts'), { recursive: true, mode: 0o700 });
  let summary = { runId, environment: safeText(config.environment, config, 100), userCode: config.userCode,
    expectedVersion: safeText(config.expectedVersion, config, 100), actualVersion: '',
    startedAt: new Date().toISOString(), status: 'running', cases: [], error: '' };
  saveSummary(dir, summary);
  let child;
  let interrupted = false;
  const interrupt = () => { interrupted = true; child?.kill('SIGTERM'); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    validateConfig(config);
    Object.assign(summary, await waitReady(config));
    saveSummary(dir, summary);
    if (interrupted) throw new Error('运行已取消');
    const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      /^(PATH|HOME|USER|SHELL|TMPDIR|TEMP|TMP|LANG|LC_.*|SystemRoot|DISPLAY|XAUTHORITY|PLAYWRIGHT_BROWSERS_PATH|BYCLAW_SMOKE_BROWSER_CHANNEL|BYCLAW_SMOKE_HEADLESS|BYCLAW_SMOKE_PROMPT|BYCLAW_SMOKE_REPLY_TIMEOUT_SEC)$/.test(key)));
    Object.assign(childEnv, { BYCLAW_SMOKE_RUN_DIR: dir,
      BYCLAW_SMOKE_ENV: config.environment, BYCLAW_SMOKE_BASE_URL: config.baseUrl,
      BYCLAW_SMOKE_USER_CODE: config.userCode, BYCLAW_SMOKE_EXPECTED_VERSION: config.expectedVersion,
      BYCLAW_SMOKE_PASSWORD: config.password, PLAYWRIGHT_NO_COPY_PROMPT: '1' });
    const code = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, [path.join(root, 'node_modules/@playwright/test/cli.js'), 'test'], {
        cwd: root, env: childEnv, stdio: 'inherit',
      });
      child.on('error', () => reject(new Error('无法启动 Playwright，请先安装依赖和浏览器')));
      child.on('exit', (exitCode) => resolve(exitCode));
    });
    summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
    if (interrupted) summary.error = '运行已取消，已创建的会话保留供排查';
    else if (code !== 0 && !summary.error && !summary.cases.some((item) => item.status !== 'passed' || item.cleanup === 'failed') && summary.cases.length >= 5) {
      summary.error = '浏览器执行异常，详见执行日志';
    } else if (code !== 0 && !summary.error && !summary.selected) summary.error = '浏览器未完成初始化，请检查依赖和登录环境';
  } catch (error) { summary.error = safeText(error.message, config); }
  summary.finishedAt = new Date().toISOString();
  summary.status = outcome(summary);
  saveSummary(dir, summary);
  summary.notification = config.notify && notificationTargets(config).length
    ? await notify(config, renderText(summary, false)) : { status: config.notify ? 'failed' : 'skipped', reason: config.notify ? '钉钉群 Webhook 未配置' : '手动联调关闭通知' };
  saveSummary(dir, summary);
  console.log(renderText(summary));
  console.log(`报告目录：${dir}`);
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  return summary.status === 'passed' && (!config.notify || summary.notification.status === 'sent') ? 0 : 1;
}

process.exitCode = await main();
