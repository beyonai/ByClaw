import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { saveSummary, outcome } from '../report/summary.mjs';

test('入口只导出测试通知配置，告警凭据及目标环境不受影响', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'byclaw-smoke-shell-'));
  try {
    const config = path.join(dir, 'env.k3s');
    fs.writeFileSync(config, 'export TEST_ALERT_DEPLOY_SECRET=test-only\nBYCLAW_SMOKE_ENV=wrong-environment\nSANDBOX_AUTOSCALE_DINGTALK_WEBHOOK_URL=test-webhook\nSANDBOX_AUTOSCALE_DINGTALK_SECRET=test-secret\nBYCLAW_SMOKE_DINGTALK_WEBHOOK_URL=second-webhook\nBYCLAW_SMOKE_DINGTALK_SECRET=second-secret\nBYCLAW_SMOKE_DINGTALK_GROUP=second-group\n');
    const output = path.join(dir, 'captured.json');
    fs.writeFileSync(path.join(dir, 'node'), `#!/bin/sh\nexec '${process.execPath}' -e 'require("node:fs").writeFileSync(process.env.TEST_CAPTURE, JSON.stringify({environment:process.env.BYCLAW_SMOKE_ENV,webhook:process.env.SANDBOX_AUTOSCALE_DINGTALK_WEBHOOK_URL,secret:process.env.SANDBOX_AUTOSCALE_DINGTALK_SECRET,additional:process.env.BYCLAW_SMOKE_DINGTALK_WEBHOOK_URL,additionalSecret:process.env.BYCLAW_SMOKE_DINGTALK_SECRET,group:process.env.BYCLAW_SMOKE_DINGTALK_GROUP,leaked:process.env.TEST_ALERT_DEPLOY_SECRET,args:process.argv.slice(1)}))' "$@"\n`, { mode: 0o700 });
    const entry = fileURLToPath(new URL('../../../../scripts/run-release-smoke.sh', import.meta.url));
    const result = spawnSync('sh', [entry, '--env', 'test'], { env: { PATH: `${dir}:${process.env.PATH}`,
      BYCLAW_SMOKE_ENV: 'target-environment', BYCLAW_SMOKE_NOTIFY_CONFIG: config, TEST_CAPTURE: output }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const captured = JSON.parse(fs.readFileSync(output));
    assert.equal(captured.environment, 'target-environment');
    assert.equal(captured.webhook, undefined);
    assert.equal(captured.secret, undefined);
    assert.equal(captured.additional, 'second-webhook');
    assert.equal(captured.additionalSecret, 'second-secret');
    assert.equal(captured.group, 'second-group');
    assert.equal(captured.leaked, undefined);
    assert.deepEqual(captured.args.slice(-2), ['--env', 'test']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('入口自动读取本地私有通知配置，CI 环境配置优先且不泄露其他凭据', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'byclaw-smoke-default-'));
  try {
    const scripts = path.join(dir, 'scripts');
    const notifyDir = path.join(dir, 'tests/integration/release-smoke');
    const bin = path.join(dir, 'bin');
    for (const folder of [scripts, notifyDir, bin]) fs.mkdirSync(folder, { recursive: true });
    const entry = path.join(scripts, 'run-release-smoke.sh');
    fs.copyFileSync(fileURLToPath(new URL('../../../../scripts/run-release-smoke.sh', import.meta.url)), entry);
    fs.writeFileSync(path.join(notifyDir, '.env.notify.local'), 'BYCLAW_SMOKE_DINGTALK_WEBHOOK_URL=local-webhook\nBYCLAW_SMOKE_DINGTALK_SECRET=local-secret\nBYCLAW_SMOKE_DINGTALK_GROUP=local-group\nexport TEST_OTHER_SECRET=not-exported\n');
    const output = path.join(dir, 'captured.json');
    fs.writeFileSync(path.join(bin, 'node'), `#!/bin/sh\nexec '${process.execPath}' -e 'require("node:fs").writeFileSync(process.env.TEST_CAPTURE, JSON.stringify({webhook:process.env.BYCLAW_SMOKE_DINGTALK_WEBHOOK_URL,secret:process.env.BYCLAW_SMOKE_DINGTALK_SECRET,group:process.env.BYCLAW_SMOKE_DINGTALK_GROUP,leaked:process.env.TEST_OTHER_SECRET}))'\n`, { mode: 0o700 });
    for (const explicit of [false, true]) {
      const env = { PATH: `${bin}:${process.env.PATH}`, TEST_CAPTURE: output };
      if (explicit) Object.assign(env, { BYCLAW_SMOKE_DINGTALK_WEBHOOK_URL: 'ci-webhook',
        BYCLAW_SMOKE_DINGTALK_SECRET: 'ci-secret', BYCLAW_SMOKE_DINGTALK_GROUP: 'ci-group' });
      const result = spawnSync('sh', [entry], { env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const captured = JSON.parse(fs.readFileSync(output));
      assert.deepEqual(captured, { webhook: explicit ? 'ci-webhook' : 'local-webhook',
        secret: explicit ? 'ci-secret' : 'local-secret', group: explicit ? 'ci-group' : 'local-group' });
      assert.equal(result.stdout.includes('secret'), false);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('未完成清理不能通过；通知失败使执行状态失败，重发后可恢复', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'byclaw-smoke-report-'));
  try {
    const summary = { status: 'passed', cases: Array.from({ length: 5 }, (_, index) => ({ index: index + 1,
      name: '员工', agentId: String(index), status: 'passed', cleanup: 'retained' })), startedAt: 'start' };
    assert.equal(outcome(summary), 'cleanup_failed');
    summary.cases.forEach((item) => { item.cleanup = 'deleted'; });
    saveSummary(dir, summary);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'status.json'))).status, 'running');
    summary.finishedAt = 'end';
    summary.notification = { status: 'failed', reason: '机器人停用' };
    saveSummary(dir, summary);
    let status = JSON.parse(fs.readFileSync(path.join(dir, 'status.json')));
    assert.equal(status.status, 'error');
    assert.equal(status.testStatus, 'passed');
    assert.match(fs.readFileSync(path.join(dir, 'report.txt'), 'utf8'), /机器人停用/);
    summary.notification = { status: 'sent' };
    saveSummary(dir, summary);
    status = JSON.parse(fs.readFileSync(path.join(dir, 'status.json')));
    assert.equal(status.status, 'passed');
    assert.equal(status.passed, 5);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('重发入口只发送到测试报告群，保存发送结果并返回正确退出码', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'byclaw-smoke-notify-'));
  try {
    const run = fileURLToPath(new URL('../run.mjs', import.meta.url));
    const preload = path.join(dir, 'mock-fetch.mjs');
    fs.writeFileSync(preload, `import fs from 'node:fs'; globalThis.fetch = async (href) => { fs.appendFileSync(process.env.TEST_CAPTURE, new URL(href).searchParams.get('access_token') + '\\n'); return {ok:true,status:200,json:async()=>({errcode:process.env.TEST_REPORT_FAIL === 'true' ? 400102 : 0,errmsg:'机器人停用'})}; };`);
    const report = path.join(dir, 'report');
    const capture = path.join(dir, 'requests.txt');
    const summary = { status: 'passed', cases: Array.from({ length: 5 }, (_, index) => ({ index: index + 1,
      name: '员工', agentId: String(index), status: 'passed', cleanup: 'deleted' })), startedAt: 'start', finishedAt: 'end' };
    for (const scenario of [{ fail: false, original: true }, { fail: true, original: true }, { fail: false, original: false }]) {
      saveSummary(report, summary);
      fs.writeFileSync(capture, '');
      const result = spawnSync(process.execPath, ['--import', preload, run, '--notify-only', report], {
        encoding: 'utf8', env: { PATH: process.env.PATH, TEST_REPORT_FAIL: String(scenario.fail), TEST_CAPTURE: capture,
          SANDBOX_AUTOSCALE_DINGTALK_WEBHOOK_URL: scenario.original ? 'https://oapi.dingtalk.com/robot/send?access_token=first' : '',
          BYCLAW_SMOKE_DINGTALK_WEBHOOK_URL: 'https://oapi.dingtalk.com/robot/send?access_token=second',
          BYCLAW_SMOKE_DINGTALK_GROUP: '百应AI原生实验室【内部】' },
      });
      assert.equal(result.status, scenario.fail ? 1 : 0, result.stderr);
      const stored = JSON.parse(fs.readFileSync(path.join(report, 'summary.json')));
      assert.equal(stored.notification.targets[0].status, scenario.fail ? 'failed' : 'sent');
      assert.equal(stored.notification.targets.length, 1);
      assert.equal(fs.readFileSync(capture, 'utf8'), 'second\n'.repeat(scenario.fail ? 3 : 1));
      assert.equal(JSON.parse(fs.readFileSync(path.join(report, 'status.json'))).status, scenario.fail ? 'error' : 'passed');
      assert.ok(fs.readFileSync(path.join(report, 'report.txt'), 'utf8').includes(`百应AI原生实验室【内部】：${scenario.fail ? '发送失败' : '已发送'}`));
      assert.equal(result.stdout.includes('access_token'), false);
      assert.equal(JSON.stringify(stored).includes('access_token'), false);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('两种发布包装脚本仅在部署成功且启用时触发，测试失败向上传递', () => {
  const repo = fileURLToPath(new URL('../../../../', import.meta.url));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'byclaw-smoke-hook-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.mkdirSync(path.join(dir, 'envs/test'), { recursive: true });
    const config = 'HOST=example.invalid\nDEPLOY_DIR=/test\nK3S_API_HOST=example.invalid\nK3S_REMOTE_PASSWORD=test-only\nBYCLAW_K3S_CLEAN_STALE_PROCESSES=false\n';
    fs.writeFileSync(path.join(dir, 'envs/test/.env'), config);
    fs.writeFileSync(path.join(dir, 'envs/test/env.k3s'), config);
    fs.writeFileSync(path.join(dir, 'scripts/run-release-smoke.sh'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$TEST_HOOK_CAPTURE"\nexit "${TEST_SMOKE_EXIT:-0}"\n');
    for (const name of ['git', 'tar']) fs.writeFileSync(path.join(dir, `bin/${name}`), '#!/bin/sh\nprintf "fixture archive"\n', { mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'bin/ssh'), '#!/bin/sh\ncat >/dev/null\ncase "$*" in *"sh deploy.sh"*|*"sh deploy/k3s/deploy.sh"*) exit "${TEST_REMOTE_EXIT:-0}";; esac\n', { mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'bin/sshpass'), '#!/bin/sh\nshift 2\nexec "$@"\n', { mode: 0o700 });
    for (const script of ['deploy.sh', 'deploy-k3s.sh']) {
      fs.copyFileSync(path.join(repo, 'scripts', script), path.join(dir, 'scripts', script));
      const capture = path.join(dir, 'hook.txt');
      for (const scenario of [
        { action: 'update', enabled: 'false', hook: false, exit: 0 },
        { action: 'stop', enabled: 'true', hook: false, exit: 0 },
        { action: 'init', enabled: 'true', hook: true, exit: 0 },
        { action: 'update', enabled: 'true', hook: true, smokeExit: 1, exit: 1 },
        { action: 'update', enabled: 'true', hook: false, remoteExit: 9, exit: 9 },
      ]) {
        fs.rmSync(capture, { force: true });
        const result = spawnSync('sh', [path.join(dir, 'scripts', script), 'test', scenario.action], {
          cwd: dir, encoding: 'utf8', env: { PATH: `${dir}/bin:${process.env.PATH}`,
            BYCLAW_SMOKE_ENABLED: scenario.enabled, TEST_HOOK_CAPTURE: capture,
            TEST_REMOTE_EXIT: String(scenario.remoteExit || 0), TEST_SMOKE_EXIT: String(scenario.smokeExit || 0) },
        });
        assert.equal(result.status, scenario.exit, `${script} ${JSON.stringify(scenario)}: ${result.stderr}`);
        assert.equal(fs.existsSync(capture), scenario.hook);
        if (scenario.hook) assert.equal(fs.readFileSync(capture, 'utf8'), '--env\ntest\n--require-version\n');
      }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
