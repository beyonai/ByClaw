import { useCallback, useSyncExternalStore } from 'react';
import {
  getStoredProjectScopeId,
  saveProjectScopeIdToStorage,
  subscribeProjectScopeId,
} from '@/pages/projectSpace/constants';

/** 会话和项目模块共用的当前项目状态，任一入口更新后其它入口会在同一标签页立即同步。 */
export const useProjectScopeId = () => {
  const projectScopeId = useSyncExternalStore(subscribeProjectScopeId, getStoredProjectScopeId, () => undefined);
  const updateProjectScopeId = useCallback((projectId?: string | number) => {
    saveProjectScopeIdToStorage(projectId);
  }, []);

  return [projectScopeId, updateProjectScopeId] as const;
};

export default useProjectScopeId;
