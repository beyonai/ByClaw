import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getProject } from '../service';
import type { ProjectSpace } from '../types';
import { normalizeProjectDetail } from '../utils';

/**
 * 项目大详情数据源。
 *
 * `requestedProjectId` 是 URL 上显式指定的项目（深链/刷新时的权威值），优先级高于共享作用域：
 * 它可能不在已加载的项目列表页里（列表每页 30 条），此时直接按 id 取详情补齐，
 * 不能因为「列表里查不到」就回落成默认项目。
 */
export const useProjectDetail = (projects: ProjectSpace[], activeProjectId?: string, requestedProjectId?: string) => {
  const fallbackProject = useMemo(() => {
    // 选中项目由 URL/缓存解析完成后再加载，避免列表刚返回时短暂展示错误的第一个项目。
    if (!activeProjectId) return undefined;
    // 列表数据已做过标准化，但这里仍统一转字符串，兼容其它入口传入数字项目 ID。
    return projects.find((item) => `${item.projectId}` === `${activeProjectId}`);
  }, [activeProjectId, projects]);
  const [activeProject, setActiveProject] = useState<ProjectSpace | undefined>(fallbackProject);
  const [loading, setLoading] = useState(false);
  const latestRequestIdRef = useRef(0);
  // 记录已经按 id 补齐过的请求，避免详情请求失败后无限重试。
  const fetchedRequestedIdRef = useRef<string | undefined>(undefined);

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

  useEffect(() => {
    const normalizedRequestedId = `${requestedProjectId ?? ''}`.trim();
    if (!normalizedRequestedId) {
      fetchedRequestedIdRef.current = undefined;
      return;
    }
    // URL 指定的项目已在列表中时交给上面的详情请求处理，这里只补齐分页未覆盖的项目。
    if (fallbackProject?.projectId) return;
    if (fetchedRequestedIdRef.current === normalizedRequestedId) return;

    const numericProjectId = Number(normalizedRequestedId);
    if (!Number.isFinite(numericProjectId)) return;

    fetchedRequestedIdRef.current = normalizedRequestedId;
    let cancelled = false;
    setLoading(true);
    void getProject(numericProjectId)
      .then((detail) => {
        if (cancelled) return;
        const project = normalizeProjectDetail(detail);
        if (project?.projectId) setActiveProject(project);
      })
      .catch((error) => {
        if (!cancelled) console.error('Failed to load requested project detail:', error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fallbackProject?.projectId, requestedProjectId]);

  return {
    activeProject,
    loading,
    refreshProject: fetchProjectDetail,
  };
};
