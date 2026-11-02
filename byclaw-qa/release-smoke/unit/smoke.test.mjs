import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { loadConfig, validateConfig, validateNotification, notificationTargets, safeText, appUrl } from '../config.mjs';
import { TurnTracker, mayDelete, businessData } from '../helpers/protocol.mjs';
import { validateReply, normalizedText } from '../helpers/reply.mjs';
import { waitReady } from '../helpers/readiness.mjs';
import { outcome, renderText, renderJunit } from '../report/summary.mjs';
import { notify, signedWebhook } from '../report/dingtalk.mjs';
import { visibleCandidates, targetIndex } from '../helpers/candidates.mjs';

const employee = { name: '员工甲', agentId: '42', ids: ['42', 'agent-code'] };
const request = { type: 'LLM_MESSAGE', clientRequestId: 'query_answer', chatContent: '你好',
  resourceList: [{ resourceType: 'DIG_EMPLOYEE', resourceId: '42' }] };
const frame = (event, data, requestId = 'query_answer') => JSON.stringify({ event, clientRequestId: requestId,
  data: JSON.stringify({ sessionId: '123', ...data }) });
const trackerFor = () => { const tracker = new TurnTracker(employee); tracker.outgoing(JSON.stringify(request)); return tracker; };
const detail = { sessionId: '123', messageId: '456', usage: 2, isComplete: true, msgStatus: 0,
  metadata: JSON.stringify({ agentId: '42' }), finalContent: '你好，欢迎！' };

test('搜索同名员工时按冻结的资源 ID 定位；员工组位置保留用于对应 UI', () => {
  const list = visibleCandidates([{ id: 'group', agentType: '017', name: '组' }, {},
    { id: 'network', agentType: '012' }, { id: 'other', name: employee.name }, { id: '42', name: employee.name }]);
  assert.equal(list.length, 3);
  assert.equal(targetIndex(list, employee), 2);
  assert.throws(() => targetIndex([...list, { id: '42' }], employee));
  assert.throws(() => targetIndex([], employee));
});

test('配置保留账号前导零；自动发布必须指定版本；密码只从环境获取', () => {
  const env = { BYCLAW_SMOKE_PASSWORD: 'test-only', BYCLAW_SMOKE_DINGTALK_WEBHOOK_URL: 'https://oapi.dingtalk.com/robot/send?access_token=test-only' };
  const config = loadConfig(['--env', 'test', '--base-url', 'https://example.com/beyond/chat/', '--user', '0027002543', '--require-version'], env);
  assert.equal(config.userCode, '0027002543');
  assert.throws(() => validateConfig(config), /预期版本/);
  config.expectedVersion = 'v1';
  validateConfig(config);
  assert.throws(() => loadConfig(['--password', 'test-only'], env));
  assert.throws(() => validateConfig({ ...config, baseUrl: 'https://user:pass@example.com/beyond/chat/' }));
});

test('诊断文本隐藏密码和机器人凭据', () => {
  const config = { password: 'hidden-password', webhook: 'https://example.com/secret-url', webhookSecret: 'hidden-secret' };
  const result = safeText(`${Object.values(config).join(' ')} access_token=abc token=xyz`, config);
  for (const value of [...Object.values(config), 'abc', 'xyz']) assert.equal(result.includes(value), false);
});

test('同时配置告警凭据时仍只使用测试报告群配置', () => {
  const config = loadConfig([], { BYCLAW_SMOKE_DINGTALK_WEBHOOK_URL: 'https://oapi.dingtalk.com/robot/send?access_token=second',
    BYCLAW_SMOKE_DINGTALK_SECRET: 'second-secret', BYCLAW_SMOKE_DINGTALK_GROUP: '百应AI原生实验室【内部】',
    SANDBOX_AUTOSCALE_DINGTALK_WEBHOOK_URL: 'https://oapi.dingtalk.com/robot/send?access_token=first',
    SANDBOX_AUTOSCALE_DINGTALK_SECRET: 'first-secret' });
  validateNotification(config);
  assert.equal(notificationTargets(config)[0].name, '百应AI原生实验室【内部】');
  assert.equal(notificationTargets(config).length, 1);
  assert.equal(config.webhook, 'https://oapi.dingtalk.com/robot/send?access_token=second');
  assert.equal(config.webhookSecret, 'second-secret');
  for (const webhook of ['https://example.com/robot/send?access_token=bad', 'https://oapi.dingtalk.com/robot/send', 'invalid']) {
    assert.throws(() => validateNotification({ ...config, webhook }), /Webhook/);
  }
});

test('只认本轮最终事件；其他请求和中间输出不能算通过', () => {
  const tracker = trackerFor();
  tracker.incoming(frame('appStreamResponse', { messageId: 'old', agentId: '42' }, 'old-request'));
  assert.equal(tracker.done, false);
  tracker.incoming(frame('initialization', { messageId: '456', metadata: '{"agentId":"42"}' }));
  tracker.incoming(frame('answerDelta', { substance: '部分回答' }));
  assert.equal(tracker.done, false);
  tracker.incoming(frame('appStreamResponse', { messageId: '456' }));
  assert.equal(tracker.done, true);
  assert.equal(tracker.observedAgent, true);
  assert.equal(tracker.clientMessageId, 'answer');
  assert.equal(tracker.sessionId, '123');
});

test('错误员工、多个员工、复用会话与不同会话均不可清理', () => {
  for (const change of [{ sessionId: 'old' }, { resourceList: [] }, { resourceList: [...request.resourceList, request.resourceList[0]] }]) {
    const tracker = new TurnTracker(employee);
    tracker.outgoing(JSON.stringify({ ...request, ...change }));
    tracker.incoming(frame('appStreamResponse', { messageId: '456' }));
    assert.ok(tracker.error);
    assert.equal(mayDelete({ status: 'passed' }, tracker, new Set(['123'])), false);
  }
  const wrong = trackerFor();
  wrong.incoming(frame('initialization', { agentId: 'wrong' }));
  assert.ok(wrong.error);
  const multiple = trackerFor();
  multiple.incoming(frame('createSession', {}));
  multiple.incoming(frame('appStreamResponse', { sessionId: 'other', messageId: '456' }));
  assert.ok(multiple.error);
});

test('失败、未完成、未知会话永不删除；仅本轮成功会话可删除', () => {
  const tracker = trackerFor();
  tracker.incoming(frame('appStreamResponse', { messageId: '456' }));
  assert.equal(mayDelete({ status: 'failed' }, tracker, new Set(['123'])), false);
  assert.equal(mayDelete({ status: 'passed' }, tracker, new Set()), false);
  assert.equal(mayDelete({ status: 'passed' }, tracker, new Set(['123'])), true);
  tracker.incoming(frame('error', {}));
  assert.equal(mayDelete({ status: 'passed' }, tracker, new Set(['123'])), false);
  assert.throws(() => businessData({ code: 401, data: { text: '失败' } }));
});

test('最终回答校验拒绝空答案、进行中、串号及异常正文', () => {
  const tracker = trackerFor();
  tracker.incoming(frame('appStreamResponse', { messageId: '456' }));
  assert.equal(validateReply(detail, tracker), '你好，欢迎！');
  assert.equal(validateReply({ ...detail, isComplete: false }, tracker), '你好，欢迎！');
  assert.equal(validateReply({ ...detail, finalContent: null, messageContent: '<think>思考过程</think>你好' }, tracker), '你好');
  assert.throws(() => validateReply({ ...detail, finalContent: '<think>只有思考过程</think>' }, tracker));
  for (const change of [{ finalContent: '' }, { isComplete: false, msgStatus: undefined }, { isComplete: false, msgStatus: 1 }, { sessionId: 'old' },
    { messageId: 'other' }, { usage: 1 }, { metadata: '{"agentId":"other"}' },
    { metadata: '{}' }, { finalContent: '请求失败，请重试' }]) {
    assert.throws(() => validateReply({ ...detail, ...change }, tracker));
  }
  assert.equal(validateReply({ ...detail, finalContent: undefined, messageContent: '旧版本的完整回答' }, tracker), '旧版本的完整回答');
  assert.equal(normalizedText('**你好**\n欢迎'), '你好欢迎');
});

test('少于五位与清理失败不会报告全部通过；JUnit保留逐项结果', () => {
  const summary = { environment: 'test', userCode: '001', actualVersion: 'v1', cases: [], status: 'incomplete' };
  assert.equal(outcome(summary), 'incomplete');
  assert.match(renderText(summary), /0\/5/);
  summary.cases = Array.from({ length: 5 }, (_, index) => ({ index: index + 1, name: `员工${index}`, agentId: String(index), status: 'passed', cleanup: 'deleted' }));
  assert.equal(outcome(summary), 'passed');
  summary.cases[0].cleanup = 'failed';
  assert.equal(outcome(summary), 'cleanup_failed');
  summary.cases[1].status = 'failed';
  summary.cases[1].reason = '<wrong & denied>';
  assert.equal(outcome(summary), 'failed');
  assert.match(renderJunit(summary), /tests="5" failures="2"/);
  assert.match(renderJunit(summary), /name="employee_1_0"/);
  assert.match(renderJunit(summary), /&lt;wrong &amp; denied&gt;/);
});

test('钉钉签名及业务错误重试；HTTP200不等于通知成功', async () => {
  const config = { webhook: 'https://oapi.dingtalk.com/robot/send?access_token=test-only', webhookSecret: 'test-secret' };
  const signed = new URL(signedWebhook(config.webhook, config.webhookSecret, 100));
  assert.equal(signed.searchParams.get('sign'), createHmac('sha256', config.webhookSecret).update('100\ntest-secret').digest('base64'));
  let attempts = 0;
  const result = await notify(config, '报告', async (_, options) => {
    assert.equal(JSON.parse(options.body).text.content, '报告');
    return { ok: true, json: async () => ({ errcode: ++attempts < 3 ? 310000 : 0 }) };
  }, async () => {});
  assert.equal(result.status, 'sent');
  assert.equal(result.attempts, 3);
  const failure = await notify(config, '报告', async () => { throw new Error(config.webhook); }, async () => {});
  assert.equal(failure.status, 'failed');
  assert.equal(JSON.stringify(failure).includes('access_token'), false);
});

test('报告只发送到指定群并加签，告警机器人不接收报告', async () => {
  const config = loadConfig([], { SANDBOX_AUTOSCALE_DINGTALK_WEBHOOK_URL: 'https://oapi.dingtalk.com/robot/send?access_token=first',
    SANDBOX_AUTOSCALE_DINGTALK_SECRET: 'first-secret',
    BYCLAW_SMOKE_DINGTALK_WEBHOOK_URL: 'https://oapi.dingtalk.com/robot/send?access_token=second',
    BYCLAW_SMOKE_DINGTALK_SECRET: 'second-secret' });
  const sent = [];
  const result = await notify(config, 'ByClaw 发布后自动测试', async (href) => {
    const url = new URL(href);
    const token = url.searchParams.get('access_token');
    sent.push(token);
    const secret = config.webhookSecret;
    assert.equal(url.searchParams.get('sign'), createHmac('sha256', secret).update(`${url.searchParams.get('timestamp')}\n${secret}`).digest('base64'));
    return { ok: true, status: 200, json: async () => token === 'first' ? { errcode: 400102, errmsg: '机器人停用' } : { errcode: 0 } };
  }, async () => {});
  assert.deepEqual(sent, ['second']);
  assert.equal(result.status, 'sent');
  assert.deepEqual(result.targets.map(({ name, status }) => ({ name, status })), [
    { name: '百应AI原生实验室【内部】', status: 'sent' }]);
  const summary = { status: 'passed', cases: [], notification: result };
  assert.match(renderText(summary), /百应AI原生实验室【内部】：已发送/);
  for (const secret of [config.webhook, config.webhookSecret]) {
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test('缺少测试群配置时明确失败，绝不回退发送到告警群', async () => {
  const config = loadConfig([], { SANDBOX_AUTOSCALE_DINGTALK_WEBHOOK_URL: 'https://oapi.dingtalk.com/robot/send?access_token=first',
    SANDBOX_AUTOSCALE_DINGTALK_SECRET: 'first-secret' });
  assert.equal(config.webhook, '');
  assert.deepEqual(notificationTargets(config), []);
  assert.throws(() => validateNotification(config), /未配置/);
  let attempts = 0;
  const result = await notify(config, '报告', async () => { attempts++; });
  assert.equal(attempts, 0);
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /未配置/);
});

test('环境就绪检查等待正确版本；旧页面不能触发测试', async () => {
  const config = { baseUrl: 'https://example.com/beyond/chat/', expectedVersion: 'v2', readyTimeoutMs: 500 };
  assert.equal(appUrl(config, 'build-info.json?smoke=1'), 'https://example.com/beyond/build-info.json?smoke=1');
  let polls = 0;
  const result = await waitReady(config, async (url) => {
    if (url.includes('/chat/')) polls++;
    return { ok: true, json: async () => url.includes('health') ? { status: 'UP' } : { version: polls < 2 ? 'v1' : 'v2', commit: 'abc' } };
  }, async () => {});
  assert.equal(polls, 2);
  assert.deepEqual(result, { actualVersion: 'v2', commit: 'abc' });
  await assert.rejects(waitReady({ ...config, readyTimeoutMs: 5 }, async () => ({ ok: false }), async () => {}), /就绪超时/);
});
