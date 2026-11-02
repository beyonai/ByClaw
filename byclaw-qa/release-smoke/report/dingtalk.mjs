import { createHmac } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { notificationTargets, safeText, validateNotification } from '../config.mjs';

export function signedWebhook(webhook, secret, timestamp = Date.now()) {
  const url = new URL(webhook);
  if (secret) {
    url.searchParams.set('timestamp', String(timestamp));
    url.searchParams.set('sign', createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64'));
  }
  return url.href;
}

export async function notify(config, text, fetchImpl = fetch, wait = delay) {
  try { validateNotification(config); }
  catch (error) { return { status: 'failed', reason: safeText(error.message, config) }; }
  const targets = [];
  for (const target of notificationTargets(config)) {
    const result = await notifyOne({ ...config, webhook: target.webhook, webhookSecret: target.webhookSecret }, text, fetchImpl, wait);
    targets.push({ name: target.name, ...result });
  }
  const failed = targets.filter((target) => target.status === 'failed');
  return { status: failed.length ? 'failed' : 'sent', targets,
    attempts: targets.reduce((total, target) => total + target.attempts, 0),
    ...(failed.length ? { reason: failed.map((target) => `${target.name}：${target.reason}`).join('\n') } : {}) };
}

async function notifyOne(config, text, fetchImpl, wait) {
  // Leave room below the robot's message size limit, including multibyte names.
  let content = text;
  while (Buffer.byteLength(content, 'utf8') > 18000) content = content.slice(0, -100);
  if (content !== text) content += '\n（详情已省略，请查看本地报告）';
  let reason = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchImpl(signedWebhook(config.webhook, config.webhookSecret), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content } }),
        signal: AbortSignal.timeout(10000),
      });
      const body = await response.json();
      if (response.ok && body.errcode === 0) return { status: 'sent', attempts: attempt };
      reason = `HTTP ${response.status || '未知'}，errcode ${String(body.errcode || '未知')}：${safeText(body.errmsg, config, 160)}`;
    } catch (error) { reason = `网络请求失败（${safeText(error.cause?.code || error.name, config, 60)}）`; }
    if (attempt < 3) await wait(attempt * 1000);
  }
  return { status: 'failed', attempts: 3, reason: `钉钉群通知未成功：${reason}；测试结果已保存，可单独重发` };
}
