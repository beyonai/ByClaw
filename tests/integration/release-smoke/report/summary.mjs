import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export function atomicJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

export function outcome(summary) {
  if (summary.error) return 'error';
  if (summary.cases.some((item) => item.status === 'failed')) return 'failed';
  if (summary.cases.length < 5 || summary.cases.some((item) => item.status !== 'passed')) return 'incomplete';
  if (summary.cases.some((item) => item.cleanup !== 'deleted')) return 'cleanup_failed';
  return 'passed';
}

export function renderText(summary, includeNotification = true) {
  const labels = { passed: '全部通过', failed: '存在失败', error: '执行错误', incomplete: '覆盖不足', cleanup_failed: '功能通过，会话清理失败' };
  const passed = summary.cases.filter((item) => item.status === 'passed').length;
  const lines = ['ByClaw 发布后自动测试', `环境：${summary.environment}`, `用户：${summary.userCode}`,
    `版本：${summary.actualVersion || '未获取'}（预期：${summary.expectedVersion || '手动联调未指定'}）`,
    `结果：${labels[summary.status] || summary.status}，${passed}/5 通过`,
    '范围：@ 全部列表前五位单个数字员工（跳过员工组）；逐个新建对话',
    `时间：${summary.startedAt}`, `运行编号：${summary.runId}`];
  if (summary.error) lines.push(`执行错误：${summary.error}`);
  if (summary.cases.length < 5) lines.push(`覆盖：本轮仅测试 ${summary.cases.length} 位员工，要求 5 位`);
  for (const item of summary.cases) {
    lines.push('', `${item.index}. ${item.name}（${item.agentId}）：${item.status === 'passed' ? '通过' : '失败'}，${((item.durationMs || 0) / 1000).toFixed(1)}秒`);
    if (item.reason) lines.push(`原因：${item.reason}`);
    if (item.cleanup === 'deleted') lines.push('测试会话已删除');
    else if (item.sessionUrl) lines.push(`保留会话：${item.sessionUrl}`);
    if (item.cleanup === 'failed') lines.push('会话清理失败，需人工处理');
  }
  if (includeNotification && summary.notification) {
    lines.push('', `群通知：${summary.notification.status}`);
    for (const target of summary.notification.targets || []) lines.push(`${target.name}：${target.status === 'sent' ? '已发送' : '发送失败'}`);
    if (summary.notification.status === 'failed') lines.push(summary.notification.reason);
  }
  return lines.join('\n');
}

const xml = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
export function renderJunit(summary) {
  const cases = summary.cases.map((item) => ({ ...item, name: `employee_${item.index}_${item.agentId}`,
    failure: item.status !== 'passed' ? item.reason || '对话测试未通过' : item.cleanup === 'failed' ? '成功会话清理失败' : '' }));
  if (summary.error) cases.push({ name: 'environment', failure: summary.error });
  if (!summary.error && summary.cases.length < 5) cases.push({ name: 'coverage', failure: '可选择员工不足五位' });
  if (summary.notification?.status === 'failed') cases.push({ name: 'notification', failure: summary.notification.reason });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites><testsuite name="release-smoke" tests="${cases.length}" failures="${cases.filter((c) => c.failure).length}" errors="0" skipped="0">${cases.map((item) => `<testcase classname="release-smoke" name="${xml(item.name)}" time="${(item.durationMs || 0) / 1000}">${item.failure ? `<failure message="${xml(item.failure)}"/>` : ''}</testcase>`).join('')}</testsuite></testsuites>\n`;
}

export function saveSummary(dir, summary) {
  atomicJson(path.join(dir, 'summary.json'), summary);
  mkdirSync(path.join(dir, 'reports'), { recursive: true });
  writeFileSync(path.join(dir, 'reports/junit.xml'), renderJunit(summary), { mode: 0o600 });
  writeFileSync(path.join(dir, 'report.txt'), renderText(summary), { mode: 0o600 });
  atomicJson(path.join(dir, 'status.json'), {
    status: !summary.finishedAt || !summary.notification ? 'running'
      : summary.notification.status === 'failed' ? 'error'
        : summary.status === 'passed' ? 'passed' : summary.status === 'error' ? 'error' : 'failed',
    testStatus: summary.status, notification: summary.notification?.status || 'pending',
    updatedAt: new Date().toISOString(), startedAt: summary.startedAt, finishedAt: summary.finishedAt || null,
    total: 5, passed: summary.cases.filter((item) => item.status === 'passed').length,
    failed: summary.cases.filter((item) => item.status === 'failed').length,
    uncovered: Math.max(0, 5 - summary.cases.length),
  });
}
