import { useCallback, useRef, useState } from 'react';
import type { SearchInfo, SearchMode, SearchStatus, WebSearchResult } from '../types';
import {
  fetchWebSearch,
  importWebSearchResults,
  mockSearchKnowledgeBase,
  mockSearchEnterpriseKnowledgeBase,
} from '../services';
import useGlobal from '@/hooks/useGlobal';
import { useDispatch } from '@umijs/max';
import { generateUniqueId } from '@/utils/math';

export const useSearch = () => {
  const [searchInfo, setSearchInfo] = useState<SearchInfo>({ query: '', mode: 'webSearch' });
  const [searchStatus, setSearchStatus] = useState<SearchStatus>('idle');
  const [searchResults, setSearchResults] = useState<WebSearchResult[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const requestIdRef = useRef('');
  const { sessionId, setSessionId, agentId } = useGlobal();
  const dispatch = useDispatch();

  const handleWebSearch = useCallback(async (query: string, mode: SearchMode) => {
    if (!query.trim()) return;
    const keyword = query.trim();
    setSearchInfo({ query: keyword, mode });
    setSearchStatus('searching');
    setSearchResults([]);

    try {
      let resp: { requestId: string; results: WebSearchResult[] };

      // 根据不同搜索模式调用不同接口
      switch (mode) {
        case 'webSearch':
          resp = await fetchWebSearch(query);
          break;
        case 'knowledgeBase':
          resp = await mockSearchKnowledgeBase(query);
          break;
        case 'enterpriseKnowledgeBase':
          resp = await mockSearchEnterpriseKnowledgeBase(query);
          break;
        default:
          resp = await fetchWebSearch(query);
      }

      setSearchResults(resp.results);
      requestIdRef.current = resp.requestId;
      setSearchStatus('completed');
    } catch (error) {
      console.error('Search failed:', error);
      setSearchStatus('idle');
    }
  }, []);

  /**
   * 删除搜索结果
   */
  const handleDeleteSearchResult = useCallback(() => {
    setSearchResults([]);
    setSearchInfo({ query: '', mode: 'webSearch' });
    setSearchStatus('idle');
    requestIdRef.current = '';
  }, []);

  /**
   * 创建导入后的资源
   */
  const createImportedResource = useCallback(
    (
      item: WebSearchResult,
      type: 'knowledgeBase' | 'enterpriseKnowledgeBase'
    ): {
      id: string;
      title: string;
      type: 'knowledgeBase' | 'enterpriseKnowledgeBase';
      docArchiveId: string;
      fileId: string;
      fileUrl: string;
      sourceUrl: string;
    } => {
      const docArchiveId = generateUniqueId();
      return {
        docArchiveId,
        id: `${type}-${docArchiveId}`,
        title: item.title,
        type,
        fileId: generateUniqueId(),
        fileUrl: '',
        sourceUrl: '',
      };
    },
    []
  );

  const handleImportSearchResults = async (targetResults: WebSearchResult[]) => {
    setIsImporting(true);

    const { mode } = searchInfo;

    try {
      // 个人知识库和企业知识库的导入直接添加到用户导入来源，不调用接口
      if (mode === 'knowledgeBase' || mode === 'enterpriseKnowledgeBase') {
        const type = mode === 'knowledgeBase' ? 'knowledgeBase' : 'enterpriseKnowledgeBase';
        const list = targetResults.map((item) => createImportedResource(item, type));

        handleDeleteSearchResult();
        setIsImporting(false);

        return {
          sessionId: sessionId || '',
          list: list.map((item) => ({
            ...item,
            id: item.id as `${typeof item.type}-${string}`,
          })),
        };
      }

      // Web搜索调用原有接口
      const resp = await importWebSearchResults(requestIdRef.current, targetResults, {
        sessionId,
        agentId,
      });
      handleDeleteSearchResult();
      setIsImporting(false);
      if (resp.sessionId !== sessionId) {
        setSessionId?.(resp.sessionId);
        dispatch({
          type: 'session/addSession',
          payload: {
            sessionId: resp.sessionId,
            sessionName: `搜索"${searchInfo.query}"的结果`,
          },
        });
      }
      return resp;
    } catch (error) {
      setSearchResults((prev) => {
        return prev.map((item) => {
          if (targetResults.some((result) => result.uuid === item.uuid)) {
            return {
              ...item,
              checked: true,
            };
          }
          return {
            ...item,
            checked: false,
          };
        });
      });
    }
    setIsImporting(false);
    return null;
  };

  return {
    requestIdRef,
    searchInfo,
    searchStatus,
    searchResults,
    isImporting,
    handleWebSearch,
    setSearchInfo,
    setSearchStatus,
    setSearchResults,
    handleDeleteSearchResult,
    handleImportSearchResults,
  };
};
