import { useEffect, useMemo, useState } from 'react';
import { useIntl } from '@umijs/max';
import { RichInputResourceList } from '@/components/QueryInput/RichInput';

import { getDcSystemConfigListByStandType } from '@/service/system';
import useAppStore from '@/models/common/useAppStore';

interface Question {
  icon?: string;
  agentId?: string;
  content: string;
  mode?: string;
  originContent?: string;
  resourceIds?: string[];
  resourceList?: RichInputResourceList;
}

// 从字符串开头提取单个 emoji 作为图标
const leadingEmojiRegex = /^\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?/u;

const extractLeadingEmoji = (text: string): string | undefined => {
  if (!text) {
    return undefined;
  }
  const match = text.match(leadingEmojiRegex);
  return match ? match[0] : undefined;
};

// 移除字符串开头的单个 emoji
const removeLeadingEmoji = (text: string): string => {
  if (!text) {
    return '';
  }
  return text.replace(leadingEmojiRegex, '').trimStart();
};

export const useQuestions = (userInfo?: { userId: string }) => {
  const intl = useIntl();
  const [memoryQuestions, setMemoryQuestions] = useState<Question[]>([]);

  const { suggestQuestions: staticQuestions, setSuggestQuestions } = useAppStore();

  useEffect(() => {
    if (!userInfo) {
      return;
    }
    getDcSystemConfigListByStandType('Recommended_Questions', { responseCfg: { hideErrorTips: true } }).then((res) => {
      if (res?.code === 0 && Array.isArray(res.data) && res.data.length > 0) {
        setSuggestQuestions(
          res.data.map((item: { standDesc: string; standDisplayValue: string }) => ({
            icon: extractLeadingEmoji(item.standDisplayValue),
            content: removeLeadingEmoji(item.standDisplayValue),
          }))
        );
      }
    });
  }, [userInfo]);

  useEffect(() => {
    if (!userInfo) {
      setMemoryQuestions([]);
    }
  }, [userInfo]);

  const questionList = useMemo<Question[]>(() => {
    if (memoryQuestions.length) {
      return memoryQuestions;
    }
    if (staticQuestions.length) {
      return staticQuestions;
    }
    return [];
  }, [intl, staticQuestions, memoryQuestions]);

  return questionList;
};
