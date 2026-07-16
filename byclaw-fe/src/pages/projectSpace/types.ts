export type ProjectType = 'normal' | 'development';

export type ProjectMemberRole = 'owner' | 'admin' | 'member';

export type ProjectResourceScope = 'shared' | 'task' | 'session';

export interface ProjectMember {
  userId: string;
  userName: string;
  role: ProjectMemberRole;
  avatar?: string;
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
  projectType: ProjectType;
  sharedFlag: boolean;
  createTime?: string;
  sessionCount?: number;
  taskCount?: number;
  fileCount?: number;
  members?: ProjectMember[];
  sessions?: ProjectSession[];
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
