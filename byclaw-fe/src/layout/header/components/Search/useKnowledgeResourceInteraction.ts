import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useIntl } from '@umijs/max';
import { message } from 'antd';
import { debounce } from 'lodash';
import { DragType } from '@/components/QueryInput/withDrag';
import type { IKnowledgeBaseItem } from '@/layout/sider/components/Knowledge/components/KnowledgeBase/types';
import type { EmployeeResourceTab } from './types';

interface Options {
  visibleEmployeeResourceTabs: EmployeeResourceTab[];
  eventEmitter: {
    emit: (eventName: string, payload?: any) => void;
  };
  setActiveTab: (title: string) => void;
}

const useKnowledgeResourceInteraction = ({ visibleEmployeeResourceTabs, eventEmitter, setActiveTab }: Options) => {
  const intl = useIntl();
  const knowledgeItemClickTimerRef = React.useRef<number | null>(null);
  const [currentKnowledgeBase, setCurrentKnowledgeBase] = useState<IKnowledgeBaseItem | null>(null);

  const knowledgeTabTitle = useMemo(
    () =>
      visibleEmployeeResourceTabs.find((tab) => tab.key === 'knowledge')?.title ||
      intl.formatMessage({ id: 'sider.knowledge' }),
    [intl, visibleEmployeeResourceTabs]
  );

  const clearKnowledgeItemClickTimer = useCallback(() => {
    if (knowledgeItemClickTimerRef.current !== null) {
      window.clearTimeout(knowledgeItemClickTimerRef.current);
      knowledgeItemClickTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearKnowledgeItemClickTimer, [clearKnowledgeItemClickTimer]);

  const handleKnowledgeBaseItemClick = useCallback(
    (event: React.MouseEvent<HTMLElement>, item: IKnowledgeBaseItem) => {
      event.stopPropagation();
      clearKnowledgeItemClickTimer();
      knowledgeItemClickTimerRef.current = window.setTimeout(() => {
        knowledgeItemClickTimerRef.current = null;
        setActiveTab(knowledgeTabTitle);
        setCurrentKnowledgeBase(item);
      }, 220);
    },
    [clearKnowledgeItemClickTimer, knowledgeTabTitle, setActiveTab]
  );

  const emitKnowledgeBaseInsert = useMemo(
    () =>
      debounce(
        (item: IKnowledgeBaseItem) => {
          eventEmitter.emit('queryInput-insert-item', {
            item,
            type: DragType.knowledgeBase,
          });
          message.success(intl.formatMessage({ id: 'search.referenceSuccess' }));
        },
        300,
        { leading: true, trailing: false }
      ),
    [eventEmitter, intl]
  );

  useEffect(() => () => emitKnowledgeBaseInsert.cancel(), [emitKnowledgeBaseInsert]);

  const handleKnowledgeBaseItemDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLElement>, item: IKnowledgeBaseItem) => {
      event.stopPropagation();
      clearKnowledgeItemClickTimer();
      emitKnowledgeBaseInsert(item);
    },
    [clearKnowledgeItemClickTimer, emitKnowledgeBaseInsert]
  );

  const handleKnowledgeBaseGoBack = useCallback(() => {
    setCurrentKnowledgeBase(null);
  }, []);

  return {
    currentKnowledgeBase,
    setCurrentKnowledgeBase,
    handleKnowledgeBaseItemClick,
    handleKnowledgeBaseItemDoubleClick,
    handleKnowledgeBaseGoBack,
  };
};

export default useKnowledgeResourceInteraction;
