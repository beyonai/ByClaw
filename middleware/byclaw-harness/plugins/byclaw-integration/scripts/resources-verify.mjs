/** ByClaw Redis resource parsing verification. */

import {
  parseByClawDigitalEmployee,
  parseByClawExpertGroup,
} from '../lib/resources.js'
import { resourceRoutingCatalog } from '../lib/index.js'

const architectRaw = {
  resourceId: '20010801',
  resourceCode: 'BYAI_DIG_EMPLOYEE_20010801',
  resourceName: '架构舵手 · 梁远图',
  resourceDesc: '负责系统架构分析与设计',
  workerAgentType: 'BYCLAW_CODE',
  prologue: JSON.stringify({ modelId: 20010925 }),
  resourceRVerid: '31',
  ability: '负责项目初始化检查和架构交接。',
  processingFlow: '先检查项目初始化，再输出架构约束。',
  coreCompetencies: JSON.stringify([{ coreCompetency: '架构设计', description: '定义模块边界和接口契约' }]),
  corePersonaDefinition: JSON.stringify([{ key: 'agent', value: '这条旧规范不应覆盖关联规范。' }]),
  relPrompt: JSON.stringify(JSON.stringify([{ name: '工作规范', key: 'agent', value: '先核对约束，再输出可实施架构。' }])),
  relSkills: [{
    resourceId: 20010766,
    skillCode: 'devloop-run-governance',
    skillType: 'hub',
    skillUrl: '/download/20010766',
    versionUrl: '/version/20010766',
  }],
}

const architect = parseByClawDigitalEmployee(architectRaw)
const thirdParty=parseByClawDigitalEmployee({...architectRaw,createType:'FROM_THIRD',integrationType:'A2A'})
if(thirdParty.createType!=='FROM_THIRD' || thirdParty.integrationType!=='A2A') throw new Error('employee integration routing metadata was lost')
if (architect.id !== '20010801' || architect.name !== '架构舵手 · 梁远图') {
  throw new Error('digital employee identity was not parsed')
}
if (!architect.persona.includes('## 工作规范\n\n先核对约束，再输出可实施架构。')
  || architect.persona.includes('旧规范')
  || !architect.persona.includes('## 核心能力\n\n负责项目初始化检查和架构交接。')
  || !architect.persona.includes('## 处理流程\n\n先检查项目初始化，再输出架构约束。')
  || !architect.persona.includes('## 核心能力清单\n\n- 架构设计：定义模块边界和接口契约')
  || !architect.capabilities.includes('模块边界')) {
  throw new Error('digital employee instructions were not fully normalized')
}
if (architect.modelId !== '20010925') throw new Error('employee prologue.modelId was not parsed')
if (architect.skills[0]?.code !== 'devloop-run-governance'
  || architect.skills[0]?.downloadUrl !== '/download/20010766') {
  throw new Error('digital employee Hub Skill reference was not parsed')
}

const group = parseByClawExpertGroup({
  resourceId: '20010819',
  resourceCode: 'BYAI_DIG_EMPLOYEE_20010819',
  resourceName: 'ByClaw研发专家团',
  resourceDesc: '研发闭环专家团',
  configVersion: '20011389',
  workerAgentType: 'BY_SUPER',
  employeeGroupMembers: [{
    resourceId: architect.id,
    resourceCode: architect.code,
    name: architect.name,
    description: architect.description,
    teamRole: '架构负责人',
    sortOrder: 2,
    workerAgentType: architect.workerAgentType,
  }],
})
if (group.id !== '20010819' || group.configVersion !== '20011389'
  || group.members[0]?.employeeId !== architect.id
  || group.members[0]?.role !== '架构负责人') {
  throw new Error('expert group membership was not parsed')
}

const routingCatalog = resourceRoutingCatalog({
  employees: [architect],
  groups: [group],
  directEmployeeIds: [architect.id],
})
const routingText = JSON.stringify(routingCatalog)
if (routingText.includes('skills') || routingText.includes('tools') || routingText.includes('persona')) {
  throw new Error('routing catalog exposed child Agent internals')
}
if (routingCatalog.employees[0]?.template_id !== `byclaw-employee-${architect.id}`
  || routingCatalog.groups[0]?.template_id !== `byclaw-group-${group.id}`) {
  throw new Error('routing catalog omitted template routing identity')
}
if (routingCatalog.groups[0]?.members[0]?.role !== '架构负责人') {
  throw new Error('routing catalog omitted compact expert-team roster')
}

let rejected = false
try {
  parseByClawDigitalEmployee({ resourceId: '', resourceName: '' })
} catch {
  rejected = true
}
if (!rejected) throw new Error('invalid employee boundary was silently accepted')

console.log('ByClaw resource parsing checks passed')
