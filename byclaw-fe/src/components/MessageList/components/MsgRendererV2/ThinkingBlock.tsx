import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import classnames from 'classnames';
import { isEmpty, set } from 'lodash';

import type { IMessage, IMessageListItem } from '@/typescript/message';
import ThinkNewRootTitle from '@/components/MessagesComp/Think/ThinkRootTitle/components/ThinkNewRootTitle';
import { transformList } from '@/components/MessageList/components/ThinkingProcessRender/util';
import type { TreeNode } from '@/components/MessageList/components/ThinkingProcessRender/typescript';
import styles from '@/components/MessageList/components/ThinkingProcessRender/index.module.less';

type Props = {
  blockId: string;
  items: IMessageListItem[];
  message: IMessage;
  ended: boolean;
  updateMessage: (message: IMessage) => IMessage | void;
};

export default function ThinkingBlock({ blockId, items, message, ended, updateMessage }: Props) {
  const intl = useIntl();
  const [collapsed, setCollapsed] = useState(ended);
  const transformedList = useMemo(
    () => transformList(items, ended, message.messageId),
    [items, ended, message.messageId]
  );

  useEffect(() => {
    setCollapsed(ended);
  }, [ended]);

  const updateItem = useCallback(
    (path: string, value: unknown) => {
      const [localIndexText, ...itemPathParts] = path.split('.');
      const sourceItem = items[Number(localIndexText)];
      const index = message.thinkList?.findIndex((item) => item.seq === sourceItem?.seq) ?? -1;
      if (index < 0 || !itemPathParts.length) return message;
      const next = { ...message };
      set(next, `thinkList.${index}.${itemPathParts.join('.')}`, value);
      updateMessage(next);
      return next;
    },
    [items, message, updateMessage]
  );

  if (isEmpty(items)) return null;

  return (
    <div id={`thinkingBlock_${message.msgId}_${blockId}`}>
      <p style={{ color: '#707680' }}>
        {ended ? (
          <span className="ub ub-ac pointer gap12" onClick={() => setCollapsed((value) => !value)}>
            <span style={{ color: 'var(--beyond-color-text-tertiary)' }}>
              {intl.formatMessage({ id: 'thinkingProcess.done' })}
            </span>
            {collapsed ? <RightOutlined style={{ fontSize: 12 }} /> : <DownOutlined style={{ fontSize: 12 }} />}
          </span>
        ) : (
          <span className={classnames(styles.highlightText, styles.autoHighlight)}>
            {intl.formatMessage({ id: 'thinkingProcess.thinking' })}
          </span>
        )}
      </p>
      {!collapsed && (
        <div className={styles.thinkingProcessWrapper}>
          {transformedList.map((item) => (
            <ThinkNewRootTitle
              key={`${message.msgId}_${blockId}_${item.content.orderId || item.messageIdx}`}
              treeNode={item as TreeNode}
              message={message}
              updateMessageListItemContent={updateItem}
            />
          ))}
        </div>
      )}
    </div>
  );
}
