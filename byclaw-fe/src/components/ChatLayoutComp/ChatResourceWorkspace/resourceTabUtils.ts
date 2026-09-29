export type SessionFileTabKey = 'file' | 'sharedFile' | 'projectFile';

/** 本地共享文件始终展示，仅非默认项目额外展示项目云盘。 */
export const getSessionFileTabKeys = (projectId?: number): SessionFileTabKey[] => [
  'file',
  'sharedFile',
  ...(Number.isFinite(projectId) && projectId !== -1 ? (['projectFile'] as SessionFileTabKey[]) : []),
];

export type SessionResourceTabKey = SessionFileTabKey | 'code';

/** 侧栏与加号菜单共享分类可见性，避免切换项目或会话后入口不一致。 */
export const getSessionResourceTabKeys = (projectId?: number, sessionId?: string): SessionResourceTabKey[] => [
  ...getSessionFileTabKeys(projectId),
  ...(sessionId && Number(projectId) > 0 ? (['code'] as SessionResourceTabKey[]) : []),
];
