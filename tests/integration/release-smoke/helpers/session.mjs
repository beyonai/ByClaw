import { expect } from '@playwright/test';
import { api, clearMentions, openEmployees } from './auth.mjs';
import { validateReply, normalizedText } from './reply.mjs';
import { businessData } from './protocol.mjs';
import { employeeName, visibleCandidates, targetIndex } from './candidates.mjs';

export function watchTurn(page, tracker) {
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => tracker.outgoing(payload.toString()));
    socket.on('framereceived', ({ payload }) => tracker.incoming(payload.toString()));
  });
  // Support older builds that deliver the same events over HTTP SSE.
  page.on('request', (request) => {
    if (request.url().includes('/superAgentChat') && request.method() === 'POST') {
      try { tracker.outgoing(request.postData()); } catch { /* Failure is detected by timeout. */ }
    }
  });
  page.on('response', async (response) => {
    if (!response.url().includes('/superAgentChat')) return;
    try {
      if (!response.ok()) { tracker.error = `对话接口 HTTP ${response.status()}`; return; }
      for (const frame of (await response.text()).split(/\r?\n\r?\n/)) {
        const event = frame.match(/^event:\s*(.+)$/m)?.[1];
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        if (event) tracker.incoming(JSON.stringify({ event, data }));
        else if (data) tracker.incoming(data);
      }
    } catch { /* Stream errors remain failed, never a synthetic completion. */ }
  });
}

export async function sendToEmployee(page, config, employee) {
  const editor = await clearMentions(page);
  const panel = await openEmployees(page);
  const search = panel.locator('input').first();
  const responsePromise = page.waitForResponse((res) => {
    if (!res.url().includes('/queryMyCreatedAndSubscribedAgents')) return false;
    try { return res.request().postDataJSON()?.keyword === employee.name; } catch { return false; }
  }, { timeout: 20000 });
  await search.fill(employee.name);
  const response = await responsePromise;
  const candidates = visibleCandidates(businessData(await response.json())?.list || []);
  const index = targetIndex(candidates, employee);
  const cards = panel.locator('.ant-list-item, .beyond-list-item');
  await expect(cards).toHaveCount(candidates.length, { timeout: 15000 });
  // Search may return multiple employees with the same name. Verify the entire
  // rendered order, then use the frozen ID's position from this exact response.
  await expect.poll(async () => cards.evaluateAll((els) => els.map((el) =>
    el.querySelector('.ant-list-item-meta-title span span, .beyond-list-item-meta-title span span')?.textContent?.trim() || '')),
  { timeout: 15000 }).toEqual(candidates.map(employeeName));
  const title = cards.nth(index).locator('.ant-list-item-meta-title, .beyond-list-item-meta-title');
  // Click the title, never the avatar (which opens an employee drawer).
  await title.click();
  await expect(panel).toBeHidden({ timeout: 10000 });
  await editor.click();
  await editor.press('End');
  await editor.pressSequentially(config.prompt, { delay: 5 });
  await editor.press('Enter');
}

export async function checkReply(page, tracker, config) {
  await expect.poll(() => tracker.done || Boolean(tracker.error), { timeout: config.replyTimeoutMs,
    message: '等待当前员工最终回复超时' }).toBe(true);
  if (tracker.error) throw new Error(tracker.error);
  if (!tracker.sent || !tracker.sessionId || !tracker.messageId) throw new Error('最终回复缺少本轮会话或消息标识');
  const row = page.locator(`[id="wrapper_${tracker.clientMessageId || tracker.messageId}"]`);
  await row.waitFor({ state: 'visible', timeout: 15000 });
  const answer = row.locator('[data-frombeyond="true"]');
  await answer.waitFor({ state: 'visible', timeout: 15000 });
  const detail = await api(page, '/byaiService/chat/getMessageById', { data: { messageId: tracker.messageId } });
  const text = validateReply(detail, tracker);
  const visible = await answer.innerText();
  if (!normalizedText(visible).includes(normalizedText(text).slice(0, 24))) throw new Error('网页未显示最终回答正文');
}

export async function deleteSuccessfulSession(page, tracker) {
  await api(page, '/byaiService/assiman/removeConversation', { data: { sessionId: tracker.sessionId } });
}
