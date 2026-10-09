import { expect } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { businessData } from './protocol.mjs';
import { employeeName, visibleCandidates } from './candidates.mjs';

export async function api(page, endpoint, { method = 'GET', data = {} } = {}) {
  const auth = await page.evaluate(() => ({ userCode: localStorage.getItem('uc') || '',
    token: localStorage.getItem('Beyond-Token') || '', sso: localStorage.getItem('SSO-TOKEN') || '' }));
  const nonce = randomUUID();
  const timestamp = String(Date.now());
  const params = method === 'POST' ? JSON.stringify(data) : Object.entries(data)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
  const headers = {
    'Beyond-Token': auth.token, 'SSO-TOKEN': auth.sso, language: 'zh-CN',
    'x-signature-nonce': nonce, 'x-signature-timestamp': timestamp,
    'x-signature-value': createHash('md5').update(`${auth.userCode}${nonce}${timestamp}${params}{#@*A12^c0+}`).digest('hex'),
  };
  const url = new URL(endpoint, page.url()).href;
  const response = method === 'POST'
    ? await page.request.post(url, { headers, data, timeout: 15000 })
    : await page.request.get(url, { headers, params: data, timeout: 15000 });
  if (!response.ok()) throw new Error(`接口 HTTP ${response.status()}`);
  return businessData(await response.json());
}

export async function verifyIdentity(page, config) {
  const user = await api(page, '/byaiService/system/session/currentUser', { data: { terminal: 'PC' } });
  if (String(user?.userCode) !== config.userCode) throw new Error('登录身份与指定测试用户不一致');
}

export async function login(page, config) {
  await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const account = page.locator('#login_account_accountCode');
  if (!await account.isVisible()) {
    const loginButton = page.getByRole('button', { name: /登\s*录|Log in|Sign in/i }).first();
    await loginButton.waitFor({ state: 'visible', timeout: 15000 });
    await loginButton.click();
  }
  await account.waitFor({ state: 'visible', timeout: 15000 });
  const dialog = page.getByRole('dialog').filter({ has: account });
  const agreement = dialog.getByRole('checkbox').first();
  if (await agreement.count() && !await agreement.isChecked()) await agreement.check();
  await account.fill(config.userCode);
  await page.locator('#login_account_accountPwd').fill(config.password);
  const responsePromise = page.waitForResponse((res) => res.url().includes('/system/session/loginByUsername') && res.request().method() === 'POST', { timeout: 30000 });
  await page.locator('#login_account').getByRole('button').click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error('登录请求失败');
  const body = await response.json();
  businessData(body);
  await expect(account).toBeHidden({ timeout: 15000 });
  await verifyIdentity(page, config);
}

export async function clearMentions(page) {
  const editor = page.locator('[data-slate-editor="true"][contenteditable="true"]').last();
  await editor.waitFor({ state: 'visible', timeout: 15000 });
  // Use the editor's real controls, rather than mutating React/Slate state.
  for (let attempts = 0; attempts < 10; attempts++) {
    const mentions = editor.locator('[data-slate-void="true"] [contenteditable="false"]');
    if (!await mentions.count()) break;
    await mentions.first().click();
  }
  if (await editor.locator('[data-slate-void="true"]').count()) throw new Error('无法清除新会话输入框中的历史员工');
  return editor;
}

export async function openEmployees(page) {
  await page.getByRole('button', { name: /@数字员工|Mention digital employee|打开聊天工具|Open chat tools/i }).click();
  const panel = page.locator('.ant-popover:visible, .beyond-popover:visible')
    .filter({ has: page.locator('.ant-list, .beyond-list') }).last();
  await panel.waitFor({ state: 'visible', timeout: 15000 });
  // Older builds expose category tabs; current builds directly render the All list.
  const all = panel.getByRole('tab', { name: /^(全部|All)$/ });
  if (await all.count()) await all.click();
  return panel;
}

export async function selectEmployees(page) {
  await clearMentions(page);
  const responses = [];
  const handler = async (res) => {
    if (!res.url().includes('/queryMyCreatedAndSubscribedAgents')) return;
    try { responses.push(businessData(await res.json())?.list || []); } catch { /* Checked below. */ }
  };
  page.on('response', handler);
  try {
    const panel = await openEmployees(page);
    await expect.poll(() => responses.length, { timeout: 20000 }).toBeGreaterThan(0);
    const cards = panel.locator('.ant-list-item, .beyond-list-item');
    if (!responses.flat().length) return [];
    await cards.first().waitFor({ state: 'visible', timeout: 15000 });
    const candidates = visibleCandidates(responses.at(-1));
    await expect(cards).toHaveCount(candidates.length, { timeout: 15000 });
    const count = candidates.length;
    const selected = [];
    for (let i = 0; i < count && selected.length < 5; i++) {
      const card = cards.nth(i);
      await card.scrollIntoViewIfNeeded();
      const title = card.locator('.ant-list-item-meta-title, .beyond-list-item-meta-title').first();
      await title.waitFor({ state: 'visible', timeout: 15000 });
      const names = await title.locator('span').evaluateAll((els) => els.map((el) => el.textContent?.trim()).filter(Boolean));
      const item = candidates[i];
      if (!names.includes(employeeName(item))) throw new Error('@ 列表显示顺序与资源响应不一致，停止以免测试错员工');
      // Phase 1 covers individual digital employees, preserving the All list order.
      if (String(item.agentType || item.workerAgentType || '') === '017') continue;
      const employee = { name: employeeName(item),
        title: (await title.textContent()).trim().replace(/\s+/g, ' '), agentId: String(item.id || item.resourceCode),
        ids: [...new Set([item.id, item.resourceId, item.resourceCode].filter((key) => key !== undefined && key !== null).map(String))] };
      if (selected.some((previous) => previous.agentId === employee.agentId)) throw new Error('候选列表包含重复员工');
      selected.push(employee);
    }
    return selected;
  } finally { page.off('response', handler); }
}
