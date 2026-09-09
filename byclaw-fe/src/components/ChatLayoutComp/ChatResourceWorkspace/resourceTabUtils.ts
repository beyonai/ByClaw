export type SessionFileTabKey = 'file' | 'sharedFile' | 'projectFile';

/** 本地共享文件始终展示，仅非默认项目额外展示项目云盘。 */
export const getSessionFileTabKeys = (projectId?: number): SessionFileTabKey[] => [
  'file',
  'sharedFile',
  ...(Number.isFinite(projectId) && projectId !== -1 ? (['projectFile'] as SessionFileTabKey[]) : []),
];
