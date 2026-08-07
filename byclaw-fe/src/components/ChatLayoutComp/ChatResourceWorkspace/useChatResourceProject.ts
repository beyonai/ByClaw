import { useCallback, useEffect, useRef, useState } from 'react';
import { getProject, listProjects } from '@/pages/projectSpace/service';
import { getArrayData, normalizeProject, normalizeProjectDetail } from '@/pages/projectSpace/utils';
import type { ProjectSpace } from '@/pages/projectSpace/types';

interface ChatResourceProjectState {
  project?: ProjectSpace;
  loading: boolean;
}

export const useChatResourceProject = (projectId?: number): ChatResourceProjectState => {
  const [state, setState] = useState<ChatResourceProjectState>({ loading: true });
  const requestSequenceRef = useRef(0);

  const loadProject = useCallback(async () => {
    const requestSequence = ++requestSequenceRef.current;
    setState((current) => ({ ...current, loading: true }));
    try {
      if (projectId) {
        const response = await getProject(projectId);
        if (requestSequence === requestSequenceRef.current) {
          setState({ project: normalizeProjectDetail(response), loading: false });
        }
        return;
      }

      // 会话没有项目归属时，沿用项目空间的默认项目作为资源容器。
      const response = await listProjects({ pageNum: 1, pageSize: 200 });
      const defaultProject = getArrayData(response)
        .map(normalizeProject)
        .find((item) => item.projectType === 'default');
      if (requestSequence === requestSequenceRef.current) {
        setState({ project: defaultProject, loading: false });
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
