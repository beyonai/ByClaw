import type { ReactNode } from 'react';
import { message } from 'antd';

export type ResourceActionFeedback = {
  success: (content: ReactNode) => void;
  error: (content: ReactNode) => void;
  warning: (content: ReactNode) => void;
};

let operationSequence = 0;

/** 操作与后续单行刷新共用一个提示；结果替换 loading，finally 不误关掉结果提示。 */
export async function runWithResourceFeedback(
  action: (feedback: ResourceActionFeedback) => void | Promise<void>,
  processingText: string,
  failureText: string
) {
  const key = `resource-operation-${++operationSequence}`;
  let settled = false;
  message.loading({ key, content: processingText, duration: 0 });
  const feedback: ResourceActionFeedback = {
    success: (content) => {
      settled = true;
      message.success({ key, content });
    },
    error: (content) => {
      settled = true;
      message.error({ key, content });
    },
    warning: (content) => {
      settled = true;
      message.warning({ key, content });
    },
  };
  try {
    await action(feedback);
  } catch (error: any) {
    feedback.error(error?.message || (typeof error === 'string' ? error : failureText));
  } finally {
    // 没有结果的提前返回也必须清理，且仅清理本次操作的提示。
    if (!settled) message.destroy(key);
  }
}
