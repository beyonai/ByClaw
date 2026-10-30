import type { ChatRuntimeType } from '@/utils/chatRuntime';

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

export const getVisibleSessionFileTabKeys = (
  tabs: SessionResourceTabKey[],
  runtimeType?: ChatRuntimeType
): SessionFileTabKey[] =>
  tabs.filter((key): key is SessionFileTabKey => key !== 'code' && !(runtimeType !== 'openclaw' && key === 'file'));

/** 聊天资源入口统一遵守运行时能力；项目空间暂停期间不在任一入口展示。 */
export const getVisibleSessionResourceTabKeys = (
  tabs: SessionResourceTabKey[],
  runtimeType?: ChatRuntimeType,
  showProjectSpace = false
): SessionResourceTabKey[] =>
  tabs.filter((key) => (key !== 'code' || showProjectSpace) && !(runtimeType !== 'openclaw' && key === 'file'));
