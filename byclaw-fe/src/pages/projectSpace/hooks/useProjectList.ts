import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import { listProjects } from '../service';
import type { ProjectSpace } from '../types';
import { getArrayData, normalizeProject } from '../utils';

export const useProjectList = () => {
  const [projects, setProjects] = useState<ProjectSpace[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const latestProjectRequestIdRef = useRef(0);

  const fetchProjects = useCallback(
    async (searchKeyword = keyword) => {
      const requestId = ++latestProjectRequestIdRef.current;
      setLoading(true);
      try {
        // 项目列表搜索走后端 keyword，避免列表数据量变大后只在前端过滤当前页数据。
        const res = await listProjects(
          { keyword: searchKeyword.trim() || undefined },
          { responseCfg: { hideErrorTips: true } }
        );
        const nextProjects = getArrayData(res).map(normalizeProject);
        // 创建项目后的刷新可能晚于初始列表请求，只允许最新请求覆盖下拉数据。
        if (requestId !== latestProjectRequestIdRef.current) return nextProjects;
        setProjects(nextProjects);
        // 调用方在新建后需要从最新列表中定位新项目并设为当前项目。
        return nextProjects;
      } catch (error) {
        if (requestId !== latestProjectRequestIdRef.current) return [] as ProjectSpace[];
        // 左侧小列表需要就地提示，避免接口失败时只结束 loading 但界面没有反馈。
        const errorMessage = typeof error === 'string' && error.trim() ? error : '项目列表加载失败';
        console.error('Failed to load project list:', error);
        message.error(errorMessage);
        return [] as ProjectSpace[];
      } finally {
        if (requestId === latestProjectRequestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [keyword]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchProjects(keyword);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [fetchProjects, keyword]);

  const filteredProjects = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter((item) => {
      return (
        item.projectName.toLowerCase().includes(query) ||
        (item.description || '').toLowerCase().includes(query) ||
        (item.sessions || []).some((session) => {
          return (
            session.sessionName.toLowerCase().includes(query) ||
            (session.sessionContent || '').toLowerCase().includes(query)
          );
        })
      );
    });
  }, [keyword, projects]);

  return {
    projects,
    filteredProjects,
    loading,
    keyword,
    setKeyword,
    fetchProjects,
  };
};
