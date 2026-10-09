import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, safeText } from '../config.mjs';
import { login, selectEmployees, verifyIdentity } from '../helpers/auth.mjs';
import { TurnTracker, mayDelete } from '../helpers/protocol.mjs';
import { watchTurn, sendToEmployee, checkReply, deleteSuccessfulSession } from '../helpers/session.mjs';
import { atomicJson, outcome, saveSummary } from '../report/summary.mjs';

test('指定用户的前五位员工各自独立对话', async ({ browser }) => {
  const config = loadConfig();
  const dir = process.env.BYCLAW_SMOKE_RUN_DIR!;
  const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
  const createdIds = new Set<string>();
  const seenIds = new Set<string>();
  const bootstrap = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  let state;
  let employees = [];
  try {
    const page = await bootstrap.newPage();
    await login(page, config);
    employees = await selectEmployees(page);
    summary.selected = employees;
    atomicJson(path.join(dir, 'selection.json'), employees);
    // Authentication remains in memory; no storageState file or login trace is created.
    state = await bootstrap.storageState();
  } catch (error) {
    summary.error = safeText(error.message, config);
    summary.status = 'error';
    saveSummary(dir, summary);
    throw new Error(summary.error);
  } finally { await bootstrap.close(); }

  for (const [index, employee] of employees.entries()) {
    const context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
    const page = await context.newPage();
    const tracker = new TurnTracker(employee);
    watchTurn(page, tracker);
    const started = Date.now();
    const result = { index: index + 1, name: safeText(employee.name, config, 100), agentId: employee.agentId,
      status: 'failed', cleanup: 'retained', durationMs: 0, reason: '', sessionId: '', sessionUrl: '' };
    try {
      await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded' });
      await verifyIdentity(page, config);
      await sendToEmployee(page, config, employee);
      await checkReply(page, tracker, config);
      if (seenIds.has(tracker.sessionId)) throw new Error('本轮多个员工复用了同一会话');
      createdIds.add(tracker.sessionId);
      result.status = 'passed';
    } catch (error) {
      result.reason = safeText(error.message, config);
      // Never capture login fields, including after an expired-session redirect.
      if (!await page.locator('input[type="password"]:visible').count()) {
        await page.screenshot({ path: path.join(dir, `artifacts/employee_${index + 1}.png`) }).catch(() => {});
      }
    }
    result.durationMs = Date.now() - started;
    result.sessionId = tracker.sessionId;
    if (tracker.sessionId) seenIds.add(tracker.sessionId);
    if (tracker.sessionId) {
      const link = new URL(config.baseUrl);
      link.searchParams.set('sessionId', tracker.sessionId);
      result.sessionUrl = link.href;
    }
    summary.cases.push(result);
    // Persist the test result BEFORE any deletion; failed conversations are never deleted.
    saveSummary(dir, summary);
    if (mayDelete(result, tracker, createdIds)) {
      try {
        await deleteSuccessfulSession(page, tracker);
        result.cleanup = 'deleted';
        result.sessionUrl = '';
      } catch { result.cleanup = 'failed'; }
    }
    atomicJson(path.join(dir, `artifacts/employee_${index + 1}.json`), {
      sessionId: tracker.sessionId, messageId: tracker.messageId, events: tracker.events,
    });
    summary.status = outcome(summary);
    saveSummary(dir, summary);
    await context.close();
  }
  summary.status = outcome(summary);
  saveSummary(dir, summary);
  expect(summary.status, '查看 report.txt 中的五项结果及保留的失败会话').toBe('passed');
});
