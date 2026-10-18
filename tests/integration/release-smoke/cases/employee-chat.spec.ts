import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, safeText } from '../config.mjs';
import { login, selectEmployees, verifyIdentity } from '../helpers/auth.mjs';
import { TurnTracker, mayDelete } from '../helpers/protocol.mjs';
import { watchTurn, sendToEmployee, checkReply, deleteSuccessfulSession } from '../helpers/session.mjs';
import { atomicJson, outcome, saveSummary } from '../report/summary.mjs';
import { resolveSkillAgent, selectSkills, sendToSkill } from '../helpers/skills.mjs';
import { loadSkillCases, findSkillCase, SkillTurnTracker, validateSkillResult } from '../helpers/skill-checks.mjs';

test('指定用户的前五位员工与前五个技能各自独立对话', async ({ browser }) => {
  const config = loadConfig();
  const dir = process.env.BYCLAW_SMOKE_RUN_DIR!;
  const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
  const createdIds = new Set<string>();
  const seenIds = new Set<string>();
  const bootstrap = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  let state;
  let employees = [];
  let skills = [];
  let skillAgent;
  let skillCases = [];
  const employeeGroup = summary.groups.find((group) => group.kind === 'employee');
  const skillGroup = summary.groups.find((group) => group.kind === 'skill');
  try {
    const page = await bootstrap.newPage();
    await login(page, config);
    try { employees = await selectEmployees(page); }
    catch (error) { employeeGroup.error = safeText(error.message, config); }
    summary.selected = employees;
    atomicJson(path.join(dir, 'selection.json'), employees);
    await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded' });
    try {
      skillAgent = await resolveSkillAgent(page, config);
      skillGroup.context = { agentId: skillAgent.agentId, name: safeText(skillAgent.name, config, 100) };
      skills = await selectSkills(page, skillAgent);
      skillCases = loadSkillCases(config.skillCasesFile);
    } catch (error) { skillGroup.error = safeText(error.message, config); }
    summary.selectedSkills = skills;
    atomicJson(path.join(dir, 'skill-selection.json'), { context: skillGroup.context, skills });
    saveSummary(dir, summary);
    // Authentication remains in memory; no storageState file or login trace is created.
    state = await bootstrap.storageState();
  } catch (error) {
    summary.error = safeText(error.message, config);
    summary.status = 'error';
    saveSummary(dir, summary);
    throw new Error(summary.error);
  } finally { await bootstrap.close(); }

  const targets = [
    ...employees.map((employee, index) => ({ kind: 'employee', index: index + 1, target: employee, employee })),
    ...skills.map((skill, index) => ({ kind: 'skill', index: index + 1, target: skill, employee: skillAgent })),
  ];
  for (const { kind, index, target, employee } of targets) {
    let fixture;
    let fixtureError = '';
    if (kind === 'skill') {
      try { fixture = findSkillCase(skillCases, target, employee.agentId); }
      catch (error) { fixtureError = safeText(error.message, config); }
      if (!fixture) {
        summary.cases.push({ kind, index, name: safeText(target.name, config, 100), resourceId: target.resourceId,
          agentId: employee.agentId, status: 'not_covered', cleanup: 'not_created', durationMs: 0,
          reason: fixtureError || '该技能尚未配置与资源标识及版本匹配的测试任务和结果断言' });
        saveSummary(dir, summary);
        continue;
      }
    }
    const context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
    const page = await context.newPage();
    const tracker = kind === 'skill' ? new SkillTurnTracker(employee, target, fixture) : new TurnTracker(employee);
    watchTurn(page, tracker);
    const started = Date.now();
    const result = { kind, index, name: safeText(target.name, config, 100), agentId: employee.agentId,
      resourceId: kind === 'skill' ? target.resourceId : employee.agentId,
      scope: kind === 'skill' ? safeText(fixture.scope || '技能加载与配置任务断言', config, 160) : '',
      status: 'failed', cleanup: 'retained', durationMs: 0, reason: '', sessionId: '', sessionUrl: '' };
    try {
      await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded' });
      await verifyIdentity(page, config);
      if (kind === 'skill') await sendToSkill(page, employee, target, fixture);
      else await sendToEmployee(page, config, employee);
      const text = await checkReply(page, tracker, kind === 'skill' ? { ...config, replyTimeoutMs: config.skillTimeoutMs } : config);
      if (kind === 'skill') validateSkillResult(text, fixture, tracker);
      if (seenIds.has(tracker.sessionId)) throw new Error('本轮多个测试项复用了同一会话');
      createdIds.add(tracker.sessionId);
      result.status = 'passed';
    } catch (error) {
      result.reason = safeText(error.message, config);
      // Never capture login fields, including after an expired-session redirect.
      if (!await page.locator('input[type="password"]:visible').count()) {
        await page.screenshot({ path: path.join(dir, `artifacts/${kind}_${index}.png`) }).catch(() => {});
      }
    }
    result.durationMs = Date.now() - started;
    result.sessionId = tracker.sessionId;
    if (kind === 'skill') result.evidence = tracker.evidence;
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
    atomicJson(path.join(dir, `artifacts/${kind}_${index}.json`), {
      sessionId: tracker.sessionId, messageId: tracker.messageId, events: tracker.events, evidence: result.evidence,
    });
    summary.status = outcome(summary);
    saveSummary(dir, summary);
    await context.close();
  }
  summary.status = outcome(summary);
  saveSummary(dir, summary);
  expect(summary.status, '查看 report.txt 中的两组结果、技能覆盖及保留的失败会话').toBe('passed');
});
