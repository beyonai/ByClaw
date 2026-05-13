import { useCallback } from 'react';
import useGlobal from '@/hooks/useGlobal';
import { useQuestions } from './useQuestions';

export default function useClickQuestion() {
  const { EventEmitter } = useGlobal();

  return useCallback(
    (item: ReturnType<typeof useQuestions>[number]) => {
      if (!item.resourceList || !item.resourceList.length) {
        EventEmitter.emit('queryInput-set-value', {
          inputTxt: item.content,
        });
      } else {
        EventEmitter.emit('queryInput-set-schema', {
          agentId: item.agentId,
          mode: item.mode,
          queryQuestion: item.originContent,
          inputSchema: {
            text: item.originContent,
            resourceList: item.resourceList,
          },
        });
      }
    },
    [EventEmitter]
  );
}
