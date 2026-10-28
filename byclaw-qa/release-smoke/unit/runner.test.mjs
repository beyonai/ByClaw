import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { saveSummary, outcome } from '../report/summary.mjs';

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
