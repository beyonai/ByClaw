import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SkillTurnTracker, loadSkillCases, findSkillCase, validateSkillResult } from '../helpers/skill-checks.mjs';
import { skillCandidates } from '../helpers/skills.mjs';
import { groupStats, outcome, renderText, renderJunit, saveSummary } from '../report/summary.mjs';
import { loadConfig } from '../config.mjs';

const agent = { agentId: '42', ids: ['42'], name: '测试员工' };
const skill = { resourceId: '100', name: '摘要', skillPath: '/workspace/skills/summary', packageHash: 'revision-1' };
const request = { type: 'LLM_MESSAGE', chatContent: '测试', clientRequestId: 'query_answer', resourceList: [
  { resourceType: 'DIG_EMPLOYEE', resourceId: '42' }, { resourceType: 'SKILL', resourceId: '100' }] };
const trackerFor = () => { const tracker = new SkillTurnTracker(agent, skill); tracker.outgoing(JSON.stringify(request)); return tracker; };
const frame = (data, requestId = 'query_answer') => JSON.stringify({ event: 'initialization', clientRequestId: requestId,
  data: JSON.stringify({ sessionId: 'session-1', ...data }) });
const readFrame = (input, output, status = '_DONE_') => frame({ message: { contentType: 3015, status,
  content: { orderId: 'tool-1', substance: { title: 'read', input, output } } } });
const fixture = { resourceId: '100', prompt: '返回简短摘要', checks: { all: ['发布成功'] } };

test('技能列表合并顺序与页面一致，同名技能保留独立标识，目录技能使用路径身份', () => {
  const items = skillCandidates([{ resourceId: '100', resourceName: '同名', targetContent: '{"skillPath":"/bound"}' },
    { resourceId: '101', resourceName: '同名' }], [{ skillName: '目录技能', skillPath: '/workspace/skills/custom' }]);
  assert.deepEqual(items.map((item) => item.resourceId), ['100', '101', 'WORKSPACE_SKILL:/workspace/skills/custom']);
  assert.equal(items[0].skillPath, '/bound');
});

test('技能请求必须只有本轮目标技能与指定员工，旧会话、错技能及额外技能均拒绝', () => {
  for (const change of [{ sessionId: 'old' }, { resourceList: request.resourceList.slice(0, 1) },
    { resourceList: [...request.resourceList, request.resourceList[1]] },
    { resourceList: [request.resourceList[0], { resourceType: 'SKILL', resourceId: '101' }] },
    { resourceList: [{ resourceType: 'DIG_EMPLOYEE', resourceId: 'wrong' }, request.resourceList[1]] }]) {
    const tracker = new SkillTurnTracker(agent, skill);
    tracker.outgoing(JSON.stringify({ ...request, ...change }));
    assert.ok(tracker.error);
  }
  assert.equal(trackerFor().error, '');
  const missingTask = new SkillTurnTracker(agent, skill, fixture);
  missingTask.outgoing(JSON.stringify({ ...request, chatContent: '{{DIG_EMPLOYEE_42}}{{SKILL_100}}' }));
  assert.match(missingTask.error, /缺少技能测试任务/);
});

test('DSH 持久化技能工具记录需同时匹配本轮消息、会话、技能名和文档特征', () => {
  const definition = { ...fixture, directory: 'summary', documentContains: ['测试技能说明'] };
  const tracker = new SkillTurnTracker(agent, skill, definition);
  tracker.sessionId = 'session-1';
  tracker.messageId = 'answer-1';
  const record = { contentType: '3015', orderId: 'answer-1:event:19', status: '_DONE_',
    metadata: JSON.stringify({ host_session_id: 'session-1', event_kind: 'tool.call' }),
    choices: [{ delta: { content: JSON.stringify({ title: 'skill', input: '{"name":"summary"}',
      output: '<skill_content name="summary"><skill_instructions>测试技能说明</skill_instructions></skill_content>' }) } }] };
  const detail = { sessionId: 'session-1', messageId: 'answer-1', inferLog: JSON.stringify([record]) };
  tracker.observeStored({ ...detail, inferLog: JSON.stringify([{ ...record, orderId: 'old-answer:event:19' }]) });
  assert.equal(tracker.evidence.length, 0);
  tracker.observeStored({ ...detail, inferLog: JSON.stringify([{ ...record, metadata: '{"host_session_id":"other"}' }]) });
  assert.equal(tracker.evidence.length, 0);
  tracker.observeStored(detail);
  assert.equal(tracker.evidence[0].type, 'skill_loaded');
  assert.ok(tracker.evidence[0].contentHash);
  assert.equal(JSON.stringify(tracker.evidence).includes('测试技能说明'), false);
  validateSkillResult('说明如下：\n```json\n{"answer":42}\n```', { checks: { json: { answer: 42 } } }, tracker);
  assert.throws(() => tracker.observeStored({ ...detail, messageId: 'other-answer' }), /不属于本轮/);
  assert.throws(() => validateSkillResult('发布成功', { ...fixture, toolChecks: [{ id: 'script' }] }, tracker), /工具执行/);
});

test('技能读取证据只接受本轮、精确路径、已完成且成功的工具读取', () => {
  const input = { path: `${skill.skillPath}/SKILL.md` };
  const tracker = trackerFor();
  tracker.incoming(readFrame(input, undefined, '_START_'));
  assert.equal(tracker.evidence.length, 0);
  tracker.incoming(readFrame(input, 'skill instructions'));
  assert.equal(tracker.evidence[0].type, 'skill_read');
  validateSkillResult('发布成功。', fixture, tracker);
  for (const output of ['Error: ENOENT', { success: false }, { isError: true }, { exitCode: 1 }]) {
    const failed = trackerFor();
    failed.incoming(readFrame(input, output));
    assert.equal(failed.evidence.length, 0);
  }
  const wrong = trackerFor();
  wrong.incoming(readFrame({ path: '/other/SKILL.md' }, 'success'));
  wrong.incoming(frame({ message: { contentType: 3015, status: '_DONE_', content: {
    orderId: 'tool-2', substance: { title: 'read', input, output: 'success' } } } }, 'old-request'));
  assert.equal(wrong.evidence.length, 0);
});

test('普通最终回答或模型自称使用技能不能通过，加载证据与结果断言必须同时满足', () => {
  const tracker = trackerFor();
  assert.throws(() => validateSkillResult('我已使用技能，发布成功', fixture, tracker), /执行证据/);
  tracker.incoming(frame({ skillId: '100', success: true }));
  assert.equal(tracker.evidence.length, 0);
  tracker.incoming(JSON.stringify({ event: 'skillLoaded', clientRequestId: 'query_answer', data: JSON.stringify({ sessionId: 'session-1', skillId: '100', success: true }) }));
  assert.equal(tracker.evidence.length, 1);
  assert.throws(() => validateSkillResult('其他内容', fixture, tracker), /断言/);
  validateSkillResult('发布成功', fixture, tracker);
  assert.throws(() => validateSkillResult('{"answer":41}', { checks: { json: { answer: 42 } } }, tracker), /JSON/);
  validateSkillResult('```json\n{"answer":42}\n```', { checks: { json: { answer: 42 } } }, tracker);
});

test('目标技能加载失败后换用另一个技能，即使答案正确也必须失败', () => {
  const tracker = new SkillTurnTracker(agent, skill, { ...fixture, directory: 'summary' });
  tracker.outgoing(JSON.stringify({ ...request, chatContent: fixture.prompt }));
  tracker.incoming(frame({ message: { contentType: 3015, status: '_ERROR_', content: {
    orderId: 'target-call', substance: { title: 'skill', input: '{"name":"summary"}', output: 'Error: skill is unknown' } } } }));
  tracker.incoming(frame({ message: { contentType: 3015, status: '_DONE_', content: {
    orderId: 'fallback-call', substance: { title: 'skill', input: '{"name":"other-summary"}',
      output: '<skill_content name="other-summary"><skill_instructions>fallback</skill_instructions></skill_content>' } } } }));
  assert.equal(tracker.evidence.length, 0);
  assert.throws(() => validateSkillResult('发布成功', fixture, tracker), /不能用其他技能/);
});

test('用例按技能标识、上下文及版本匹配，不按同名技能猜测，也不默认全部通过', () => {
  assert.equal(findSkillCase([fixture], { ...skill, resourceId: '101' }, agent.agentId), undefined);
  assert.equal(findSkillCase([{ ...fixture, packageHash: 'old' }], skill, agent.agentId), undefined);
  assert.equal(findSkillCase([{ ...fixture, agentId: 'other' }], skill, agent.agentId), undefined);
  assert.equal(findSkillCase([fixture], skill, agent.agentId), fixture);
  assert.throws(() => findSkillCase([fixture, fixture], skill, agent.agentId), /多个/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'byclaw-skill-cases-'));
  try {
    const file = path.join(dir, 'cases.json');
    fs.writeFileSync(file, JSON.stringify([fixture]));
    assert.deepEqual(loadSkillCases(file), [fixture]);
    fs.writeFileSync(file, '[{"resourceId":"100","prompt":"问候","checks":{}}]');
    assert.throws(() => loadSkillCases(file), /断言/);
    assert.deepEqual(loadSkillCases(''), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('两组分别要求五项，员工成功不能抵消技能缺失；JUnit 和状态保留未覆盖', () => {
  const summary = { environment: 'test', status: 'running', startedAt: 'start', finishedAt: 'end', notification: { status: 'sent' },
    groups: [{ kind: 'employee', label: '数字员工', expected: 5 }, { kind: 'skill', label: '技能', expected: 5 }],
    cases: Array.from({ length: 5 }, (_, i) => ({ kind: 'employee', index: i + 1, agentId: String(i), status: 'passed', cleanup: 'deleted' })) };
  assert.equal(outcome(summary), 'incomplete');
  summary.cases.push(...Array.from({ length: 5 }, (_, i) => ({ kind: 'skill', index: i + 1, resourceId: String(i), status: 'passed', cleanup: 'deleted' })));
  assert.equal(outcome(summary), 'passed');
  summary.cases[9].status = 'not_covered';
  summary.cases[9].reason = '缺少用例';
  summary.status = outcome(summary);
  assert.equal(summary.status, 'incomplete');
  assert.equal(groupStats(summary)[1].uncovered, 1);
  assert.match(renderText(summary), /9\/10 通过/);
  assert.match(renderText(summary), /技能：4\/5 通过/);
  assert.match(renderJunit(summary), /skipped="1"/);
  assert.match(renderJunit(summary), /skill_coverage/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'byclaw-skill-report-'));
  try {
    saveSummary(dir, summary);
    const status = JSON.parse(fs.readFileSync(path.join(dir, 'status.json')));
    assert.equal(status.total, 10);
    assert.equal(status.uncovered, 1);
    assert.equal(status.status, 'failed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  summary.groups[1].error = '默认对象为员工组';
  assert.equal(outcome(summary), 'error');
});

test('技能执行单独配置超时且有限制，测试员工由环境指定', () => {
  const config = loadConfig([], { BYCLAW_SMOKE_SKILL_AGENT_ID: '007', BYCLAW_SMOKE_SKILL_TIMEOUT_SEC: '300' });
  assert.equal(config.skillAgentId, '007');
  assert.equal(config.skillTimeoutMs, 300000);
  assert.throws(() => loadConfig([], { BYCLAW_SMOKE_SKILL_TIMEOUT_SEC: '9999' }));
});
