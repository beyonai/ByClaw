import { useState, type ReactNode } from 'react';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import Markdown from '@/components/Markdown';
import type { IMessage } from '@/typescript/message';
import { getFinalAnswerProjection, getFinalContent } from '@/utils/finalAnswer';
import { groupOrderedItems, isV2Message, mergeOrderedItems } from './ordered';
import styles from './index.module.less';

type Props = {
  msg: IMessage;
  children: (projection: ReturnType<typeof getFinalAnswerProjection>) => ReactNode;
};

export default function FinalAnswerLayout({ msg, children }: Props) {
  const intl = useIntl();
  const [collapsed, setCollapsed] = useState(true);
  const finalContent = msg.fromBeyond ? getFinalContent(msg.finalContent) : undefined;
  const ordered = isV2Message(msg);
  const projection = getFinalAnswerProjection(msg, finalContent, ordered);

  // 按去重前的分组判断：单轮思考与回答沿用原有入口，避免增加重复的折叠层级。
  const showSummary =
    finalContent !== undefined &&
    (!ordered || groupOrderedItems(mergeOrderedItems(msg.thinkList, msg.messageList)).length > 2);

  // 使用 Fragment 保持过程节点的 DOM 父级；重复事件和终态更新不重置用户的展开选择。
  return (
    <>
      {showSummary && (
        <button
          key="final-summary"
          type="button"
          className={styles.finalSummary}
          data-collapsed={collapsed}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          <span>{intl.formatMessage({ id: 'message.taskEnded' })}</span>
          {collapsed ? <RightOutlined aria-hidden="true" /> : <DownOutlined aria-hidden="true" />}
        </button>
      )}
      {showSummary && <hr key="final-divider" className={styles.finalDivider} />}
      {children(projection)}
      {finalContent !== undefined && (
        <div key="final-content" className={styles.finalContent}>
          <Markdown msg={msg} text={finalContent} />
        </div>
      )}
    </>
  );
}
