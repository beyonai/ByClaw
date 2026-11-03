import { useMemo, type ReactNode } from 'react';

import ProjectSharedFileContext from '@/components/Markdown/ProjectSharedFileContext';
import { useChatRuntime } from '@/hooks/useChatRuntime';
import { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import { DISPLAY_FILE_PATH_PREFIX } from '@/layout/sider/components/FileSiderPanel/constants';
import { getProjectSharedFilePath } from '@/layout/sider/components/FileSiderPanel/utils';

type ProjectSharedFileProviderProps = {
  children: ReactNode;
  sessionId: string;
  projectId?: number;
  projectResourceId?: string | number | null;
};

export default function ProjectSharedFileProvider({
  children,
  sessionId,
  projectId,
  projectResourceId,
}: ProjectSharedFileProviderProps) {
  const { runtimeType } = useChatRuntime(sessionId, Boolean(sessionId && projectId));
  const { resourceId: employeeResourceId } = useActiveSiderAgent();

  // 与会话侧栏使用同一文件空间，包含默认项目 project_-1。
  const resourceId = employeeResourceId || (projectResourceId ? String(projectResourceId) : undefined);
  const scope = useMemo(() => {
    if (runtimeType !== 'dsh' || !sessionId || !projectId || !resourceId) return undefined;
    return {
      sessionId,
      resourceId,
      rootPath: `${DISPLAY_FILE_PATH_PREFIX}${getProjectSharedFilePath(projectId)}`,
    };
  }, [projectId, resourceId, runtimeType, sessionId]);

  return <ProjectSharedFileContext.Provider value={scope}>{children}</ProjectSharedFileContext.Provider>;
}
