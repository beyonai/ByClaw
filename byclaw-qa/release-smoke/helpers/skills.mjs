import { expect } from '@playwright/test';
import { api } from './auth.mjs';
import { chooseEmployee } from './session.mjs';
import { businessData } from './protocol.mjs';

const object = (value) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value || {}; } catch { return {}; }
};
export function skillCandidates(bound, workspace) {
  return [...bound, ...workspace.map((item) => ({ ...item,
    resourceId: `WORKSPACE_SKILL:${item.skillPath || item.skillName}`, resourceName: item.skillName,
  }))].map((item) => {
    const ext = object(item.targetContent);
    return { resourceId: String(item.resourceId), name: String(item.resourceName),
      resourceCode: item.resourceCode || item.skillName || '', skillPath: item.skillPath || ext.skillPath || '',
      skillDocObjectKey: item.skillDocObjectKey || ext.skillDocObjectKey || '',
      packageHash: item.skillPackageHash || ext.skillPackageHash || '', version: item.version || ext.version || '' };
  });
}

export async function resolveSkillAgent(page, config) {
  const user = await api(page, '/byaiService/system/session/currentUser', { data: { terminal: 'PC' } });
  const agentId = config.skillAgentId || String(user.defaultDigEmployeeId || '');
  if (!agentId) throw new Error('用户未配置默认员工，请指定 BYCLAW_SMOKE_SKILL_AGENT_ID');
  for (let pageNum = 1; pageNum <= 20; pageNum++) {
    const data = await api(page, '/byaiService/api/v2/digitEmploy/queryMyCreatedAndSubscribedAgents', { method: 'POST',
      data: { keyword: '', pageNum, pageSize: 100 } });
    const item = (data.list || []).find((row) => String(row.id || row.resourceId) === agentId);
    if (item) {
      if (String(item.agentType || item.workerAgentType) === '017') throw new Error('技能测试上下文是数字员工组，“＋ → 技能”不可用；请指定单个数字员工');
      return { agentId, name: String(item.resourceName || item.name),
        ids: [...new Set([agentId, item.resourceCode].filter(Boolean).map(String))] };
    }
    if (!data.list?.length || pageNum * 100 >= Number(data.total || data.list.length)) break;
  }
  throw new Error('指定的技能测试员工不在用户可选择的员工列表中');
}

export async function openSkills(page, agent, keyword = '') {
  let bound = null;
  let workspace = null;
  let failure = '';
  const handler = async (response) => {
    if (!/queryDigEmployeeRelResourceAuth|qryWorkspaceSkillList/.test(response.url())) return;
    try {
      const request = response.request().postDataJSON();
      if (String(request?.resourceId) !== agent.agentId || (request?.keyword || '') !== keyword) return;
      if (response.url().includes('queryDigEmployeeRelResourceAuth') && !request.resourceBizTypeList?.includes('SKILL')) return;
      const data = businessData(await response.json());
      if (response.url().includes('qryWorkspaceSkillList')) workspace = Array.isArray(data) ? data : data.list || [];
      else bound = data.list || data.rows || [];
    } catch { failure = '技能列表接口未正常返回，停止以免覆盖范围失真'; }
  };
  page.on('response', handler);
  try {
    await page.getByRole('button', { name: /打开聊天工具|Open chat tools/i }).click();
    const panel = page.locator('.ant-popover:visible, .beyond-popover:visible').last();
    await panel.getByText(/^(技能|Skills?)$/, { exact: true }).first().click();
    if (keyword) await panel.locator('input:visible').first().fill(keyword);
    await expect.poll(() => Boolean(failure) || (bound !== null && workspace !== null), { timeout: 25000 }).toBe(true);
    if (failure) throw new Error(failure);
    const candidates = skillCandidates(bound, workspace);
    const cards = panel.locator('.ant-list-item:visible, .beyond-list-item:visible');
    await expect(cards).toHaveCount(candidates.length, { timeout: 15000 });
    await expect.poll(async () => cards.evaluateAll((elements) => elements.map((element) => {
      const title = element.querySelector('.ant-list-item-meta-title, .beyond-list-item-meta-title');
      if (!title) return '';
      const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) if (node.textContent?.trim()) return node.textContent.trim();
      return '';
    })),
    { timeout: 15000 }).toEqual(candidates.map((item) => item.name));
    return { panel, cards, candidates };
  } finally { page.off('response', handler); }
}

export async function selectSkills(page, agent) {
  await chooseEmployee(page, agent);
  const { candidates } = await openSkills(page, agent);
  if (new Set(candidates.map((item) => item.resourceId)).size !== candidates.length) throw new Error('技能列表包含重复资源标识');
  return candidates.slice(0, 5);
}

export async function sendToSkill(page, agent, skill, fixture) {
  const editor = await chooseEmployee(page, agent);
  const { panel, cards, candidates } = await openSkills(page, agent, skill.name);
  const indices = candidates.flatMap((item, index) => item.resourceId === skill.resourceId ? [index] : []);
  if (indices.length !== 1) throw new Error('无法在实际技能面板唯一定位本轮冻结的技能');
  const candidate = candidates[indices[0]];
  if (skill.packageHash && candidate.packageHash !== skill.packageHash) throw new Error('技能版本在冻结列表后发生变化');
  await cards.nth(indices[0]).locator('.ant-list-item-meta-title, .beyond-list-item-meta-title').click();
  await expect(panel).toBeHidden({ timeout: 10000 });
  await editor.click();
  await editor.press('ControlOrMeta+End');
  await editor.press('ArrowRight');
  const load = '这是发布后的技能可用性测试。请先通过只读工具读取本条消息所引用技能在当前执行环境中的 SKILL.md，再实际按技能说明完成下面的最小任务。不要读取凭据、不要修改技能或员工配置。\n';
  await page.keyboard.insertText(`${load}${fixture.prompt}`);
  await expect(editor).toContainText(fixture.prompt, { timeout: 10000 });
  await editor.press('Enter');
}
