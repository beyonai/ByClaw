import { useCallback, useEffect, useMemo, useState } from 'react';
import { getProject } from '../service';
import type { ProjectSpace } from '../types';
import { normalizeProjectDetail } from '../utils';

export const useProjectDetail = (projects: ProjectSpace[], activeProjectId?: string) => {
  const fallbackProject = useMemo(() => {
    return projects.find((item) => item.projectId === activeProjectId) || projects[0];
  }, [activeProjectId, projects]);
  const [activeProject, setActiveProject] = useState<ProjectSpace | undefined>(fallbackProject);
  const [loading, setLoading] = useState(false);

  const fetchProjectDetail = useCallback(async () => {
    if (!fallbackProject?.projectId) {
      setActiveProject(undefined);
      return;
    }
    setActiveProject(fallbackProject);
    setLoading(true);
    try {
      // 详情接口作为项目空间主数据源，后续会话、成员、统计都从这里增量承接。
      const detail = await getProject(Number(fallbackProject.projectId));
      setActiveProject(normalizeProjectDetail(detail, fallbackProject));
    } catch (error) {
      console.error('Failed to load project detail:', error);
    } finally {
      setLoading(false);
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
