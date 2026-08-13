import { useCallback, useEffect, useRef, useState } from 'react';
import { getProject, listProjects } from '@/pages/projectSpace/service';
import { getArrayData, normalizeProject, normalizeProjectDetail } from '@/pages/projectSpace/utils';
import type { ProjectSpace } from '@/pages/projectSpace/types';

interface ChatResourceProjectState {
  project?: ProjectSpace;
  loading: boolean;
}

const DEFAULT_PROJECT_CACHE_KEY = 'default';
const projectCache = new Map<string, ProjectSpace | undefined>();
const projectRequestCache = new Map<string, Promise<ProjectSpace | undefined>>();

const getProjectCacheKey = (projectId?: number) =>
  projectId && Number.isFinite(projectId) ? `project:${projectId}` : DEFAULT_PROJECT_CACHE_KEY;

const requestProject = (projectId?: number) => {
  const cacheKey = getProjectCacheKey(projectId);
  const pendingRequest = projectRequestCache.get(cacheKey);
  if (pendingRequest) return pendingRequest;

  const request = (async () => {
    if (projectId) {
      const response = await getProject(projectId);
      return normalizeProjectDetail(response);
    }

    // 会话没有项目归属时，沿用项目空间的默认项目作为资源容器。
    const response = await listProjects({ pageNum: 1, pageSize: 200 });
    return getArrayData(response)
      .map(normalizeProject)
      .find((item) => item.projectType === 'default');
  })();

  projectRequestCache.set(cacheKey, request);
  void request.then(
    (project) => {
      // 缓存被主动清理后，已经在途的旧请求不能再次写回过期项目数据。
      if (projectRequestCache.get(cacheKey) !== request) return;
      projectCache.set(cacheKey, project);
      projectRequestCache.delete(cacheKey);
    },
    () => {
      if (projectRequestCache.get(cacheKey) === request) projectRequestCache.delete(cacheKey);
    }
  );
  return request;
};

/** 项目编辑或资源绑定变化后可按项目清理；不传项目 ID 时清理全部会话项目缓存。 */
export const clearChatResourceProjectCache = (projectId?: number) => {
  if (projectId && Number.isFinite(projectId)) {
    const cacheKey = getProjectCacheKey(projectId);
    projectCache.delete(cacheKey);
    projectRequestCache.delete(cacheKey);
    return;
  }
  projectCache.clear();
  projectRequestCache.clear();
};

export const useChatResourceProject = (projectId?: number): ChatResourceProjectState => {
  const cacheKey = getProjectCacheKey(projectId);
  const [state, setState] = useState<ChatResourceProjectState>(() =>
    projectCache.has(cacheKey) ? { project: projectCache.get(cacheKey), loading: false } : { loading: true }
  );
  const requestSequenceRef = useRef(0);

  const loadProject = useCallback(async () => {
    const requestSequence = ++requestSequenceRef.current;
    const nextCacheKey = getProjectCacheKey(projectId);
    if (projectCache.has(nextCacheKey)) {
      setState({ project: projectCache.get(nextCacheKey), loading: false });
      return;
    }

    // 项目真正变化且未命中缓存时清除上一项目详情，弹窗只展示加载态，不误用旧项目模板。
    setState({ loading: true });
    try {
      // 同一项目的多个输入框或右侧资源面板共用请求，切换同项目会话时直接复用缓存。
      const nextProject = await requestProject(projectId);
      if (requestSequence === requestSequenceRef.current) {
        setState({ project: nextProject, loading: false });
      }
    } catch (error) {
      console.error('Failed to resolve the current conversation project:', error);
      if (requestSequence === requestSequenceRef.current) {
        setState({ loading: false });
      }
    }
  }, [projectId]);

  useEffect(() => {
    void loadProject();

    // 项目归属切换或面板卸载后，旧请求不再允许回写当前面板。
    return () => {
      requestSequenceRef.current += 1;
    };
  }, [loadProject]);

  return state;
};
