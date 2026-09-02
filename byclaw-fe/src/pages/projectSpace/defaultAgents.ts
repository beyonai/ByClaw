import type { DefaultAgentConfig } from '@/service/devloop';

// 默认助理:四种固定角色(架构/需求/研发/测试)的兜底配置。
// 语义:项目若未为某角色单独指定员工,则回退到全局默认(合并在后端 resolve 完成)。
// 本模块只提供角色常量与「后端配置 ↔ 前端每角色 id 映射」的纯转换,状态由各弹窗按需从接口拉取。
export type DefaultAgentRole = 'architect' | 'requirement' | 'coder' | 'tester';

// 数组顺序即界面展示顺序:架构 → 需求 → 研发 → 测试,与研发闭环推进阶段一致。
export const DEFAULT_AGENT_ROLES: DefaultAgentRole[] = ['architect', 'requirement', 'coder', 'tester'];

// 角色文案走国际化键,展示方按当前语言解析,禁止直接依赖中文常量。
export const DEFAULT_AGENT_ROLE_MESSAGE_ID: Record<DefaultAgentRole, string> = {
  architect: 'projectSpace.defaultAgent.role.architect',
  requirement: 'projectSpace.defaultAgent.role.requirement',
  coder: 'projectSpace.defaultAgent.role.coder',
  tester: 'projectSpace.defaultAgent.role.tester',
};

// 每角色一个员工 id(空串 = 未指定)。
export type DefaultAgentAssignment = Record<DefaultAgentRole, string>;

export const emptyAssignment = (): DefaultAgentAssignment => ({
  architect: '',
  requirement: '',
  coder: '',
  tester: '',
});

// 后端配置(*_agent_id)→ 前端每角色 id 映射。
export const configToAssignment = (config?: DefaultAgentConfig | null): DefaultAgentAssignment => ({
  architect: config?.architectAgentId || '',
  requirement: config?.requirementAgentId || '',
  coder: config?.coderAgentId || '',
  tester: config?.testerAgentId || '',
});

// 前端每角色 id → 后端保存入参;labelById 用于冗余带上员工名(展示列),缺省用 id 兜底。
export const assignmentToPayload = (
  assignment: Partial<DefaultAgentAssignment>,
  labelById?: Map<string, string>,
  projectId?: number
): DefaultAgentConfig => {
  const nameOf = (id?: string) => (id ? labelById?.get(id) || undefined : undefined);
  return {
    projectId,
    architectAgentId: assignment.architect || undefined,
    architectAgentName: nameOf(assignment.architect),
    requirementAgentId: assignment.requirement || undefined,
    requirementAgentName: nameOf(assignment.requirement),
    coderAgentId: assignment.coder || undefined,
    coderAgentName: nameOf(assignment.coder),
    testerAgentId: assignment.tester || undefined,
    testerAgentName: nameOf(assignment.tester),
  };
};
