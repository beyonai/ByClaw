import { knowledgeBaseListItem } from '@/typescript/chatbi';
// @ts-ignore
import { useDispatch, useSelector } from '@umijs/max';
import { isNil } from 'lodash';
import { useCallback, useEffect, useState } from 'react';
import useFocusIndicator from './useFocusIndicator';

type IExportProps = {
  loading: boolean;
  knowledgeBaseList: knowledgeBaseListItem[];
  selectedKnowledgeInfo: knowledgeBaseListItem;
  setSelectedKnowledgeInfo: (selectedInfo: knowledgeBaseListItem | null) => void;
  setDvaState: (payload: Record<string, any>) => void;
};

const useKnowledge: (params?: { setDefaultSelected?: boolean }) => IExportProps = (params) => {
  const { setDefaultSelected = true } = params || {};
  const dispatch = useDispatch();
  const [loading, setLoading] = useState(false);

  const { selectedKnowledgeInfo, knowledgeBaseList } = useSelector(({ chatBI }) => ({
    selectedKnowledgeInfo: chatBI.selectedKnowledgeInfo,
    knowledgeBaseList: chatBI.knowledgeBaseList,
    useGptSemanticResults: chatBI.useGptSemanticResults,
  }));

  const { getFocusIndicator } = useFocusIndicator();

  const selectedKnowledgeBaseId = selectedKnowledgeInfo?.knowledgeBaseId;

  // 更新选中的是知识库、指标维度问法看板关注指标及总结分析
  const setSelectedKnowledgeInfo = useCallback(
    (selectedInfo: knowledgeBaseListItem | null) => {
      if (selectedInfo?.knowledgeBaseId === selectedKnowledgeBaseId) return;

      dispatch({
        type: 'chatBI/setState',
        payload: {
          selectedKnowledgeInfo: selectedInfo,
        },
      });
      if (!selectedInfo) return;
      console.log('selectedInfo', selectedInfo);
      const { knowledgeBaseId } = selectedInfo;
      dispatch({
        type: 'chatBI/getAllIndicator',
        payload: { knowledgeBaseId },
      });
      dispatch({
        type: 'chatBI/getKnowledge',
        payload: { knowledgeBaseId },
      });
      dispatch({
        type: 'chatBI/getSearchSuggestions',
        payload: { knowledgeBaseId },
      });
      getFocusIndicator({ knowledgeBaseId });
    },
    [selectedKnowledgeBaseId]
  );

  useEffect(() => {
    // 获取初始知识库列表
    if (isNil(knowledgeBaseList)) {
      setLoading(true);
      dispatch({
        type: 'chatBI/getKnowledgeBaseByUser',
      })
        .then((resList: knowledgeBaseListItem[]) => {
          if (resList && resList.length && !selectedKnowledgeInfo && setDefaultSelected) {
            setSelectedKnowledgeInfo(resList[0]);
          }
        })
        .finally(() => setLoading(false));
    } else if (setDefaultSelected && !selectedKnowledgeInfo && knowledgeBaseList.length) {
      setSelectedKnowledgeInfo(knowledgeBaseList[0]);
    }
  }, []);

  useEffect(() => {
    if (!selectedKnowledgeBaseId) return;
    dispatch({
      type: 'chatBI/getChatSystemConfig',
      payload: {
        knowledgeBaseId: selectedKnowledgeBaseId,
      },
    });
  }, [selectedKnowledgeBaseId]);

  const setDvaState = useCallback((payload: Record<string, any>) => {
    dispatch({
      type: 'chatBI/save',
      payload: { ...payload },
    });
  }, []);

  return {
    loading,
    knowledgeBaseList,
    selectedKnowledgeInfo,
    setSelectedKnowledgeInfo,
    setDvaState,
  };
};

export default useKnowledge;
