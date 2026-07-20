import { useCallback, useEffect, useMemo, useState } from 'react';
import { message } from 'antd';
import { listProjects } from '../service';
import type { ProjectSpace } from '../types';
import { getArrayData, normalizeProject } from '../utils';

export const useProjectList = () => {
  const [projects, setProjects] = useState<ProjectSpace[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');

  const fetchProjects = useCallback(
    async (searchKeyword = keyword) => {
      setLoading(true);
      try {
        // 项目列表搜索走后端 keyword，避免列表数据量变大后只在前端过滤当前页数据。
        const res = await listProjects(
          { keyword: searchKeyword.trim() || undefined },
          { responseCfg: { hideErrorTips: true } }
        );
        setProjects(getArrayData(res).map(normalizeProject));
      } catch (error) {
        // 左侧小列表需要就地提示，避免接口失败时只结束 loading 但界面没有反馈。
        const errorMessage = typeof error === 'string' && error.trim() ? error : '项目列表加载失败';
        console.error('Failed to load project list:', error);
        message.error(errorMessage);
      } finally {
        setLoading(false);
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
