import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { useIntl } from '@umijs/max';
import { listProjects } from '../service';
import type { ProjectSpace } from '../types';
import { getArrayData, normalizeProject } from '../utils';

const PROJECT_PAGE_SIZE = 30;

export const useProjectList = () => {
  const intl = useIntl();
  const [projects, setProjects] = useState<ProjectSpace[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [pageInfo, setPageInfo] = useState({ pageNum: 0, total: 0 });
  const latestProjectRequestIdRef = useRef(0);

  const fetchProjects = useCallback(
    async (
      searchKeyword = keyword,
      options: {
        append?: boolean;
        pageNum?: number;
      } = {}
    ) => {
      const { append = false, pageNum = 1 } = options;
      const requestId = ++latestProjectRequestIdRef.current;
      setLoading(true);
      try {
        // 项目下拉每页固定请求 30 条，名称搜索交给后端，避免只过滤当前缓存页。
        const res = await listProjects(
          {
            keyword: searchKeyword.trim() || undefined,
            pageNum,
            pageSize: PROJECT_PAGE_SIZE,
          },
          { responseCfg: { hideErrorTips: true } }
        );
        const nextProjects = getArrayData(res).map(normalizeProject);
        // 创建项目后的刷新可能晚于初始列表请求，只允许最新请求覆盖下拉数据。
        if (requestId !== latestProjectRequestIdRef.current) return nextProjects;
        let mergedProjects = nextProjects;
        setProjects((previousProjects) => {
          if (!append) return nextProjects;
          const projectMap = new Map(previousProjects.map((project) => [project.projectId, project]));
          nextProjects.forEach((project) => projectMap.set(project.projectId, project));
          mergedProjects = Array.from(projectMap.values());
          return mergedProjects;
        });
        setPageInfo({
          pageNum: Number(res?.pageNum ?? pageNum),
          total: Number(res?.total ?? nextProjects.length),
        });
        // 调用方在新建后需要从最新列表中定位新项目并设为当前项目。
        return mergedProjects;
      } catch (error) {
        if (requestId !== latestProjectRequestIdRef.current) return [] as ProjectSpace[];
        // 左侧小列表需要就地提示，避免接口失败时只结束 loading 但界面没有反馈。
        const errorMessage =
          typeof error === 'string' && error.trim()
            ? error
            : intl.formatMessage({ id: 'projectSpace.message.loadFailed' });
        console.error('Failed to load project list:', error);
        message.error(errorMessage);
        return [] as ProjectSpace[];
      } finally {
        if (requestId === latestProjectRequestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [intl, keyword]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchProjects(keyword);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [fetchProjects, keyword]);

  const hasMore = projects.length < pageInfo.total;

  const loadMoreProjects = useCallback(() => {
    if (loading || !hasMore) return Promise.resolve([] as ProjectSpace[]);
    return fetchProjects(keyword, { append: true, pageNum: pageInfo.pageNum + 1 });
  }, [fetchProjects, hasMore, keyword, loading, pageInfo.pageNum]);

  return {
    projects,
    loading,
    keyword,
    setKeyword,
    fetchProjects,
    hasMore,
    loadMoreProjects,
  };
};
