import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getProject } from '../service';
import type { ProjectSpace } from '../types';
import { normalizeProjectDetail } from '../utils';

export const useProjectDetail = (projects: ProjectSpace[], activeProjectId?: string) => {
  const fallbackProject = useMemo(() => {
    // 选中项目由 URL/缓存解析完成后再加载，避免列表刚返回时短暂展示错误的第一个项目。
    if (!activeProjectId) return undefined;
    // 列表数据已做过标准化，但这里仍统一转字符串，兼容其它入口传入数字项目 ID。
    return projects.find((item) => `${item.projectId}` === `${activeProjectId}`);
  }, [activeProjectId, projects]);
  const [activeProject, setActiveProject] = useState<ProjectSpace | undefined>(fallbackProject);
  const [loading, setLoading] = useState(false);
  const latestRequestIdRef = useRef(0);

  const fetchProjectDetail = useCallback(async () => {
    const requestId = ++latestRequestIdRef.current;
    if (!fallbackProject?.projectId) {
      setActiveProject(undefined);
      setLoading(false);
      return;
    }
    setActiveProject(fallbackProject);
    setLoading(true);
    try {
      // 详情接口作为项目空间主数据源，后续会话、成员、统计都从这里增量承接。
      const detail = await getProject(Number(fallbackProject.projectId));
      if (requestId === latestRequestIdRef.current) {
        setActiveProject(normalizeProjectDetail(detail, fallbackProject));
      }
    } catch (error) {
      if (requestId === latestRequestIdRef.current) console.error('Failed to load project detail:', error);
    } finally {
      if (requestId === latestRequestIdRef.current) setLoading(false);
    }
  }, [fallbackProject]);

  useEffect(() => {
    fetchProjectDetail();
  }, [fetchProjectDetail]);

  return {
    activeProject,
    loading,
    refreshProject: fetchProjectDetail,
  };
};
