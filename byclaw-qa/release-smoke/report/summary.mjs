import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export function atomicJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

export function groupStats(summary) {
  // Reports produced before skill testing retain their original five-item scope.
  return (summary.groups || [{ kind: 'employee', label: '数字员工', expected: 5 }]).map((group) => {
    const cases = summary.cases.filter((item) => (item.kind || 'employee') === group.kind);
    const passed = cases.filter((item) => item.status === 'passed').length;
    const failed = cases.filter((item) => item.status === 'failed').length;
    return { ...group, cases, passed, failed, uncovered: Math.max(0, group.expected - passed - failed) };
  });
}

export function outcome(summary) {
  const groups = groupStats(summary);
  if (summary.error || groups.some((group) => group.error)) return 'error';
  if (summary.cases.some((item) => !groups.some((group) => group.kind === (item.kind || 'employee')))) return 'error';
  if (summary.cases.some((item) => item.status === 'failed')) return 'failed';
  if (groups.some((group) => group.uncovered || group.cases.length !== group.expected) ||
    summary.cases.some((item) => item.status !== 'passed')) return 'incomplete';
  if (summary.cases.some((item) => item.cleanup !== 'deleted')) return 'cleanup_failed';
  return 'passed';
}

export function renderText(summary, includeNotification = true) {
  const labels = { passed: '全部通过', failed: '存在失败', error: '执行错误', incomplete: '覆盖不足', cleanup_failed: '功能通过，会话清理失败' };
  const passed = summary.cases.filter((item) => item.status === 'passed').length;
  const groups = groupStats(summary);
  const total = groups.reduce((sum, group) => sum + group.expected, 0);
  const lines = ['ByClaw 发布后自动测试', `环境：${summary.environment}`, `用户：${summary.userCode}`,
    `版本：${summary.actualVersion || '未获取'}（预期：${summary.expectedVersion || '手动联调未指定'}）`,
    `结果：${labels[summary.status] || summary.status}，${passed}/${total} 通过`,
    '范围：@ 全部列表前五位单个数字员工（跳过员工组）；逐个新建对话',
    `时间：${summary.startedAt}`, `运行编号：${summary.runId}`];
  if (summary.error) lines.push(`执行错误：${summary.error}`);
  if (groups.some((group) => group.kind === 'skill')) lines.push('技能范围：固定员工上下文，“＋ → 技能”实际列表前五个；每技能独立对话');
  for (const group of groups) {
    lines.push(`${group.label}：${group.passed}/${group.expected} 通过`);
    if (group.context) lines.push(`${group.label}上下文：${group.context.name}（${group.context.agentId}）`);
    if (group.error) lines.push(`${group.label}初始化错误：${group.error}`);
    if (group.uncovered) lines.push(`${group.label}覆盖不足：${group.uncovered} 项未覆盖`);
  }
  for (const item of summary.cases) {
    const label = item.kind === 'skill' ? '技能' : '员工';
    lines.push('', `${label} ${item.index}. ${item.name}（${item.resourceId || item.agentId}）：${item.status === 'passed' ? '通过' : item.status === 'not_covered' ? '未覆盖' : '失败'}，${((item.durationMs || 0) / 1000).toFixed(1)}秒`);
    if (item.reason) lines.push(`原因：${item.reason}`);
    if (item.scope) lines.push(`本项范围：${item.scope}`);
    if (item.cleanup === 'deleted') lines.push('测试会话已删除');
    else if (item.sessionUrl) lines.push(`保留会话：${item.sessionUrl}`);
    if (item.cleanup === 'failed') lines.push('会话清理失败，需人工处理');
    if (item.evidence) lines.push(`技能证据：${item.evidence.map((entry) => entry.type).join('、') || '未获得'}`);
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
  const cases = summary.cases.map((item) => ({ ...item, name: `${item.kind || 'employee'}_${item.index}_${item.resourceId || item.agentId}`,
    skipped: item.status === 'not_covered',
    failure: item.status === 'not_covered' ? '' : item.status !== 'passed' ? item.reason || '对话测试未通过' : item.cleanup !== 'deleted' ? '成功会话清理失败' : '' }));
  if (summary.error) cases.push({ name: 'environment', failure: summary.error });
  if (!summary.error) for (const group of groupStats(summary)) {
    if (group.error) cases.push({ name: `${group.kind}_initialization`, failure: group.error });
    else if (group.uncovered) cases.push({ name: `${group.kind}_coverage`, failure: `${group.label}未覆盖 ${group.uncovered} 项，要求 ${group.expected} 项` });
  }
  if (summary.notification?.status === 'failed') cases.push({ name: 'notification', failure: summary.notification.reason });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites><testsuite name="release-smoke" tests="${cases.length}" failures="${cases.filter((c) => c.failure).length}" errors="0" skipped="${cases.filter((c) => c.skipped).length}">${cases.map((item) => `<testcase classname="release-smoke" name="${xml(item.name)}" time="${(item.durationMs || 0) / 1000}">${item.failure ? `<failure message="${xml(item.failure)}"/>` : item.skipped ? `<skipped message="${xml(item.reason)}"/>` : ''}</testcase>`).join('')}</testsuite></testsuites>\n`;
}

export function saveSummary(dir, summary) {
  const groups = groupStats(summary);
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
    total: groups.reduce((sum, group) => sum + group.expected, 0), passed: summary.cases.filter((item) => item.status === 'passed').length,
    failed: summary.cases.filter((item) => item.status === 'failed').length,
    uncovered: groups.reduce((sum, group) => sum + group.uncovered, 0),
    groups: groups.map(({ cases, ...group }) => group),
  });
}
