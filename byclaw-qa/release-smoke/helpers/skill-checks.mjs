import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { TurnTracker } from './protocol.mjs';

const parse = (value) => {
  if (typeof value !== 'string') return value || {};
  try { return JSON.parse(value); } catch { return {}; }
};
const normalize = (value) => String(value || '').replace(/\\/g, '/').replace(/\/+$/g, '');

export function loadSkillCases(file) {
  if (!file) return [];
  const cases = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(cases)) throw new Error('技能用例文件必须是 JSON 数组');
  for (const item of cases) {
    if ((!item.resourceId && !item.skillPath) || !item.prompt?.trim() ||
      !(item.checks?.all?.length || Object.keys(item.checks?.json || {}).length)) {
      throw new Error('技能用例必须指定资源 ID 或目录路径、测试输入及明确的结果断言');
    }
    if (item.checks.all && !item.checks.all.every((text) => typeof text === 'string' && text.trim())) {
      throw new Error('技能结果断言必须是非空文本');
    }
    if (item.toolChecks && (!Array.isArray(item.toolChecks) || item.toolChecks.some((check) =>
      !check.id || !Array.isArray(check.commandIncludes) || !check.commandIncludes.length ||
      !check.commandIncludes.every((part) => typeof part === 'string' && part.trim())))) {
      throw new Error('技能工具执行断言必须指定标识及非空命令条件');
    }
  }
  return cases;
}

export function findSkillCase(cases, skill, agentId) {
  const matches = cases.filter((item) =>
    (!item.agentId || String(item.agentId) === String(agentId)) &&
    (item.resourceId ? String(item.resourceId) === skill.resourceId : normalize(item.skillPath) === normalize(skill.skillPath)) &&
    (!item.packageHash || item.packageHash === skill.packageHash));
  if (matches.length > 1) throw new Error('同一技能匹配到多个测试用例');
  return matches[0];
}

export class SkillTurnTracker extends TurnTracker {
  constructor(employee, skill, fixture = {}) {
    super(employee, { skill, expectedPrompt: fixture.prompt });
    this.evidence = [];
    this.calls = new Map();
    this.fixture = fixture;
    this.loadError = '';
  }

  observe({ event, data, metadata }) {
    if (event === 'skillLoaded' && String(data.skillId || data.resourceId) === this.skill.resourceId &&
      data.success === true) this.addEvidence({ type: 'skill_loaded', resourceId: this.skill.resourceId });
    const loaded = metadata.loadedSkills;
    if (Array.isArray(loaded) && loaded.some((item) =>
      String(item?.resourceId || item?.skillId) === this.skill.resourceId && item?.status === 'loaded')) {
      this.addEvidence({ type: 'skill_loaded', resourceId: this.skill.resourceId });
    }
    const message = data.message || data;
    const content = message.content || {};
    const body = parse(content.substance || message.choices?.[0]?.delta?.content);
    const key = String(content.orderId || content.parentOrderId || content.stepId || message.orderId || '');
    if (String(message.contentType) !== '3015' || !key) return;
    if (body.eventKind === 'context') return;
    const previous = this.calls.get(key) || {};
    const call = { ...previous, ...body, input: body.input ?? previous.input };
    this.calls.set(key, call);
    const title = String(call.title || call.name || '').toLowerCase();
    const input = parse(call.input);
    const directory = this.fixture.directory || this.skill.resourceCode;
    if (title === 'skill' && input.name === directory && (message.status === '_ERROR_' || call.status === '_ERROR_' || call.isError)) {
      this.loadError = `目标技能 ${directory} 在运行环境加载失败；不能用其他技能或普通模型回答代替`;
    }
    if ((message.status || call.status) !== '_DONE_' || call.isError || call.success === false || call.error) return;
    const output = call.output ?? call.result;
    if (output === undefined || output === null || output === '') return;
    const parsedOutput = parse(output);
    if (parsedOutput.isError || parsedOutput.is_error || parsedOutput.success === false || parsedOutput.error ||
      (parsedOutput.exitCode !== undefined && parsedOutput.exitCode !== 0) ||
      /^(Error:|ENOENT|EACCES|no such file|file not found|permission denied)|(?:process exited|exit code)\D*[1-9]/i.test(String(output))) return;
    const documentMatches = (this.fixture.documentContains || []).every((value) => String(output).includes(value));
    if (title === 'skill' && directory && input.name === directory && documentMatches &&
      String(output).includes(`<skill_content name="${directory}">`) && String(output).includes('<skill_instructions>')) {
      this.addEvidence({ type: 'skill_loaded', resourceId: this.skill.resourceId, name: directory,
        contentHash: createHash('sha256').update(String(output)).digest('hex') });
    }
    const command = String(input.command || input.cmd || '');
    for (const check of this.fixture.toolChecks || []) {
      if (/bash|exec|terminal|shell/.test(title) && check.commandIncludes?.every((part) => command.includes(part))) {
        this.addEvidence({ type: `skill_execution:${check.id}`, resourceId: this.skill.resourceId });
      }
    }
    const path = normalize(input.file_path || input.filePath || input.path);
    const expectedPath = normalize(this.skill.skillDocObjectKey || (this.skill.skillPath ? `${this.skill.skillPath}/SKILL.md` : ''));
    if (expectedPath && path === expectedPath && documentMatches && /(^|[._ -])read([._ -]|$)|readfile/.test(title)) {
      this.addEvidence({ type: 'skill_read', resourceId: this.skill.resourceId, path });
    }
  }

  observeStored(detail) {
    if (String(detail.sessionId) !== this.sessionId || String(detail.messageId) !== this.messageId) {
      throw new Error('技能执行记录不属于本轮消息');
    }
    for (const field of ['inferLog', 'messageStruct']) {
      const records = parse(detail[field]);
      if (!Array.isArray(records)) continue;
      for (const record of records) {
        const metadata = parse(record.metadata);
        const belongsToMessage = String(record.orderId || '').startsWith(`${this.messageId}:`) ||
          String(record.parentOrderId || '') === this.messageId;
        if (!belongsToMessage ||
          String(metadata.host_session_id || metadata.external_session_id || '') !== this.sessionId) continue;
        this.observe({ event: record.eventType, data: record, metadata });
      }
    }
  }

  addEvidence(entry) {
    if (!this.evidence.some((item) => item.type === entry.type)) this.evidence.push(entry);
  }
}

export function validateSkillResult(text, fixture, tracker) {
  if (!tracker.evidence.length && tracker.loadError) throw new Error(tracker.loadError);
  if (!tracker.evidence.length) throw new Error('未取得本轮目标技能加载或成功读取 SKILL.md 的执行证据');
  if (!tracker.evidence.some((item) => ['skill_loaded', 'skill_read'].includes(item.type))) throw new Error('缺少目标技能加载证据');
  for (const check of fixture.toolChecks || []) {
    if (!tracker.evidence.some((item) => item.type === `skill_execution:${check.id}`)) throw new Error(`技能未完成要求的工具执行：${check.id}`);
  }
  for (const expected of fixture.checks.all || []) {
    if (!text.toLowerCase().includes(expected.toLowerCase())) throw new Error(`技能结果未满足断言：${expected}`);
  }
  for (const forbidden of fixture.checks.excludes || []) {
    if (text.toLowerCase().includes(forbidden.toLowerCase())) throw new Error('技能结果包含不应出现的内容');
  }
  if (fixture.checks.json) {
    let answer;
    try {
      const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
      if (blocks.length > 1) throw new Error('结果包含多个 JSON');
      answer = JSON.parse(blocks.length ? blocks[0][1] : text.trim());
    }
    catch { throw new Error('技能结果不是预期的 JSON'); }
    for (const [key, value] of Object.entries(fixture.checks.json)) {
      if (JSON.stringify(answer[key]) !== JSON.stringify(value)) throw new Error(`技能 JSON 结果不符合预期：${key}`);
    }
  }
}
