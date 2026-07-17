export type ProjectType = 'normal' | 'develop' | 'default';

export type ProjectShareFlag = 'N' | 'Y';

export type ProjectMemberRole = 'owner' | 'admin' | 'member';

export type ProjectResourceScope = 'shared' | 'task' | 'session';

export interface ProjectMember {
  memberId?: string | number;
  projectId?: string | number;
  userId: string | number;
  userCode?: string;
  userName: string;
  role: ProjectMemberRole;
  agentId?: string | number;
  agentName?: string;
  avatar?: string;
  createTime?: string | number;
}

export interface ProjectSession {
  sessionId: string;
  sessionName: string;
  sessionContent?: string;
  updateTime?: string;
  createTime?: string;
  projectId?: string;
  objectId?: string | number;
  objectType?: string;
  avatar?: string;
  sessionExts?: Array<{ extParamCode: string; extParamValue: any }>;
  taskId?: string;
  fileCount?: number;
}

export interface ProjectSpace {
  projectId: string;
  projectName: string;
  description?: string;
  resourceId?: string | number | null;
  projectType: ProjectType;
  isShare: ProjectShareFlag;
  sharedFlag: boolean;
  createTime?: string;
  sessionCount?: number;
  taskCount?: number;
  fileCount?: number;
  members?: ProjectMember[];
  sessions?: ProjectSession[];
  repos?: ProjectRepo[];
  shareTargets?: ProjectShareTarget[];
}

export interface ProjectRepo {
  repoId?: string | number;
  projectId?: string | number;
  repoFullName: string;
  repoUrl?: string;
  defaultBranch?: string;
  createBy?: string | number;
  createTime?: string | number;
}

export interface ProjectShareTarget {
  id: string;
  name: string;
  type: 'USER' | 'ORG' | string;
  shareId?: string | number;
  projectId?: string | number;
  targetType?: string;
  targetId?: string | number;
  targetName?: string;
  createBy?: string | number;
  createTime?: string | number;
}

export interface ProjectTask {
  taskId: string;
  projectId: string;
  taskName: string;
  description?: string;
  assigneeId?: string;
  assigneeName?: string;
  status?: 'todo' | 'doing' | 'done';
  progress?: number;
  dueTime?: string;
}

export interface ProjectResource {
  fileId: string;
  fileName: string;
  scope: ProjectResourceScope;
  sessionId?: string;
  taskId?: string;
  size?: number | string;
  updateTime?: string;
}

export interface ProjectRequirement {
  requirementId: string;
  projectId: string;
  title: string;
  sourceType?: string;
  priority?: string;
  score?: number;
  status?: string;
  createTime?: string;
}
