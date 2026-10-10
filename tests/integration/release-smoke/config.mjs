import { parseArgs } from 'node:util';

export function loadConfig(args = [], env = process.env) {
  const { values } = parseArgs({ args, options: {
    env: { type: 'string' },
    'base-url': { type: 'string' },
    user: { type: 'string' },
    version: { type: 'string' },
    'require-version': { type: 'boolean', default: false },
    'result-dir': { type: 'string' },
    'no-notify': { type: 'boolean', default: false },
    'notify-only': { type: 'string' },
    help: { type: 'boolean', default: false },
  } });
  const integer = (name, fallback, max) => {
    const value = Number(env[name] || fallback);
    if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`配置错误：${name}`);
    return value;
  };
  return {
    help: values.help,
    notifyOnly: values['notify-only'] || '',
    environment: values.env || env.BYCLAW_SMOKE_ENV || '',
    baseUrl: values['base-url'] || env.BYCLAW_SMOKE_BASE_URL || '',
    userCode: values.user || env.BYCLAW_SMOKE_USER_CODE || env.E2E_ADMIN_USER || '',
    password: env.BYCLAW_SMOKE_PASSWORD || env.E2E_ADMIN_PASS || '',
    expectedVersion: values.version || env.BYCLAW_SMOKE_EXPECTED_VERSION || '',
    requireVersion: values['require-version'],
    resultDir: values['result-dir'] || env.BYCLAW_E2E_RESULT_DIR || '',
    notify: !values['no-notify'],
    webhook: env.BYCLAW_SMOKE_DINGTALK_WEBHOOK_URL || '',
    webhookSecret: env.BYCLAW_SMOKE_DINGTALK_SECRET || '',
    groupName: env.BYCLAW_SMOKE_DINGTALK_GROUP || '百应AI原生实验室【内部】',
    channel: env.BYCLAW_SMOKE_BROWSER_CHANNEL || undefined,
    headless: env.BYCLAW_SMOKE_HEADLESS !== 'false',
    replyTimeoutMs: integer('BYCLAW_SMOKE_REPLY_TIMEOUT_SEC', 120, 600) * 1000,
    readyTimeoutMs: integer('BYCLAW_SMOKE_READY_TIMEOUT_SEC', 180, 900) * 1000,
    prompt: env.BYCLAW_SMOKE_PROMPT || '你好，这是发布后对话可用性测试。请用一句简短的话打个招呼，不调用工具，不执行其他操作。',
  };
}

export function validateConfig(config) {
  if (!config.environment || !config.baseUrl || !config.userCode || !config.password) {
    throw new Error('请配置目标环境、聊天页面地址、用户编码和登录密码');
  }
  const url = new URL(config.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('聊天页面地址必须是无凭据、无查询参数的 HTTP(S) URL');
  }
  if (!/\/chat\/?$/.test(url.pathname)) throw new Error('聊天页面地址必须以 /chat 或 /chat/ 结尾');
  if (config.requireVersion && !config.expectedVersion) throw new Error('发布后自动测试必须指定预期版本');
  if (config.notify) validateNotification(config);
}

export function validateNotification(config) {
  const targets = notificationTargets(config);
  if (!targets.length) throw new Error('未配置钉钉群 Webhook');
  for (const target of targets) {
    let webhook;
    try { webhook = new URL(target.webhook); }
    catch { throw new Error('群通知必须使用钉钉 HTTPS 自定义机器人 Webhook'); }
    if (webhook.protocol !== 'https:' || webhook.hostname !== 'oapi.dingtalk.com' || webhook.pathname !== '/robot/send'
      || webhook.username || webhook.password || !webhook.searchParams.get('access_token')) {
      throw new Error('群通知必须使用钉钉 HTTPS 自定义机器人 Webhook');
    }
  }
}

export function notificationTargets(config) {
  return config.webhook ? [{ name: safeText(config.groupName || '百应AI原生实验室【内部】', config, 100),
    webhook: config.webhook, webhookSecret: config.webhookSecret }] : [];
}

export function appUrl(config, file) {
  const url = new URL(config.baseUrl);
  url.pathname = url.pathname.replace(/\/chat\/?$/, '/');
  return new URL(file, url).href;
}

export function safeText(value, config, limit = 300) {
  let text = String(value || '').replace(/\u001b\[[0-9;]*m/g, '');
  for (const secret of [config.password, config.webhook, config.webhookSecret]) {
    if (secret) text = text.split(secret).join('[已隐藏]');
  }
  text = text.replace(/(access_token|token|password|accountPwd|secret)([=:]\s*)[^\s&"']+/gi, '$1$2[已隐藏]');
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').slice(0, limit);
}
