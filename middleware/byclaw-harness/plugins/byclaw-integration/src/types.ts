/** ByClaw resource records normalized for DSH templates. */

/** One downloadable ByClaw Hub Skill. */
export interface ByClawSkillRef {
  id: string
  code: string
  type: string
  downloadUrl: string
  versionUrl: string
}

/** One digital employee snapshot frozen when a DSH member is created. */
export interface ByClawDigitalEmployee {
  id: string
  code: string
  name: string
  description: string
  capabilities: string
  persona: string
  workerAgentType: string
  createType?: string
  integrationType?: string
  /** Baiying `prologue.modelId`; omission selects the current Redis default LLM. */
  modelId?: string
  version?: string
  skills: ByClawSkillRef[]
}

/** One ordered member declaration inside a ByClaw expert group. */
export interface ByClawExpertGroupMember {
  employeeId: string
  employeeCode: string
  name: string
  role?: string
  description?: string
  workerAgentType?: string
  order: number
}

/** One expert-group snapshot. */
export interface ByClawExpertGroup {
  id: string
  code: string
  name: string
  description: string
  workerAgentType: string
  configVersion?: string
  members: ByClawExpertGroupMember[]
}

/** Authorized expert-group leader configuration resolved by ByClaw BE. */
export interface ByClawExpertGroupRuntime {
  groupId: string
  name: string
  prompt: string
  promptVersion: string
  contextProfile: string
  configVersion: string
  modelId: string
  /** Effective authorized roster frozen with the runtime Prompt and model. */
  members: ByClawExpertGroupMember[]
}

/** Resource kinds advertised by the ByClaw catalog. */
export type ByClawResource =
  | { kind: 'employee'; employee: ByClawDigitalEmployee }
  | { kind: 'group'; group: ByClawExpertGroup }
