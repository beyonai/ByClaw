import type { ReactNode } from 'react';

import { processSessionContent } from '@/layout/sider/components/DialogueList/util';

export interface SessionSummaryResult {
  content: ReactNode;
  empty: boolean;
}

const isEmptyContent = (content: ReactNode) =>
  content === null || content === undefined || content === false || (typeof content === 'string' && !content.trim());

/**
 * 历史对话页的摘要取数（#291）：
 * 优先 sessionContent，其次首条消息正文；每个候选都经过 processSessionContent（含思考内容过滤），
 * 取第一个非空结果；都为空时返回占位文案。
 */
export const resolveSessionSummary = (item: any, emptyText: string): SessionSummaryResult => {
  const candidates = [item?.sessionContent, item?.messageDtoList?.[0]?.messageContent];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === '') continue;
    const content = processSessionContent(candidate);
    if (!isEmptyContent(content)) {
      return { content, empty: false };
    }
  }
  return { content: emptyText, empty: true };
};
