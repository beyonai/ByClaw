import React, { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import classnames from 'classnames';
import { isEmpty, set } from 'lodash';

import type { IMessage, IMessageListItem } from '@/typescript/message';
import ThinkNewRootTitle from '@/components/MessagesComp/Think/ThinkRootTitle/components/ThinkNewRootTitle';
import { transformList } from '@/components/MessageList/components/ThinkingProcessRender/util';
import type { TreeNode } from '@/components/MessageList/components/ThinkingProcessRender/typescript';
import { hasPendingEasyConfirmItem } from '@/components/MessagesComp/easyConfirm';
import styles from '@/components/MessageList/components/ThinkingProcessRender/index.module.less';
import { loadThinkingPreviewGetter } from './thinkingPreviewHandler';

type Props = {
  blockId: string;
  items: IMessageListItem[];
  message: IMessage;
  ended: boolean;
  updateMessage: (message: IMessage) => IMessage | void;
};

const getThinkingPreview = (items: IMessageListItem[], ended: boolean): ReactNode => {
  const lines = items
    .map((item) => item.content?.substance)
    .filter((substance): substance is string => typeof substance === 'string')
    .flatMap((substance) => substance.split(/\r?\n/))
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const preview = (ended ? lines[0] : lines[lines.length - 1]) || '';
  return preview.length > 120 ? `${preview.slice(0, 120)}…` : preview;
};

const getPreviewItem = (items: IMessageListItem[], ended: boolean) => {
  const previewableItems = items.filter(
    ({ content }) => content?.substance !== null && content?.substance !== undefined
  );
  return ended ? previewableItems[0] : previewableItems[previewableItems.length - 1];
};

export default function ThinkingBlock({ blockId, items, message, ended, updateMessage }: Props) {
  const intl = useIntl();
  const [collapsed, setCollapsed] = useState(true);
  const transformedList = useMemo(
    () => transformList(items, ended, message.messageId, message),
    [items, ended, message]
  );
  const hasPendingInteraction = hasPendingEasyConfirmItem(message, items);
  const effectiveCollapsed = collapsed && !hasPendingInteraction;
  const defaultPreview = useMemo(() => getThinkingPreview(items, ended), [ended, items]);
  const previewItem = useMemo(() => getPreviewItem(items, ended), [ended, items]);
  const [preview, setPreview] = useState<ReactNode>(defaultPreview);
  const hasPreview = preview !== null && preview !== undefined && preview !== '';

  useEffect(() => {
    let active = true;
    setPreview(defaultPreview);

    if (!previewItem) return () => undefined;

    loadThinkingPreviewGetter(previewItem.contentType).then((getPreview) => {
      if (!active || !getPreview) return;
      const customPreview = getPreview({
        message,
        messageListItemContent: previewItem.content,
        thinkListItem: previewItem,
      });
      if (customPreview !== null && customPreview !== undefined) setPreview(customPreview);
    });

    return () => {
      active = false;
    };
  }, [defaultPreview, message, previewItem]);

  useEffect(() => {
    setCollapsed(!hasPendingInteraction);
  }, [ended, hasPendingInteraction]);

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
    <div className={styles.thinkingBlock} id={`thinkingBlock_${message.msgId}_${blockId}`}>
      <button
        type="button"
        className={classnames(styles.thinkingSummary, { [styles.thinkingSummaryLocked]: hasPendingInteraction })}
        aria-expanded={!effectiveCollapsed}
        disabled={hasPendingInteraction}
        onClick={() => setCollapsed((value) => !value)}
      >
        <span
          className={classnames(styles.thinkingStatus, {
            [styles.highlightText]: !ended,
            [styles.autoHighlight]: !ended,
          })}
        >
          {intl.formatMessage({ id: ended ? 'thinkingProcess.done' : 'thinkingProcess.thinking' })}
        </span>
        {hasPreview && (
          <span className={styles.thinkingPreview} title={typeof preview === 'string' ? preview : undefined}>
            {preview}
          </span>
        )}
        {effectiveCollapsed ? (
          <RightOutlined className={styles.thinkingChevron} />
        ) : (
          <DownOutlined className={styles.thinkingChevron} />
        )}
      </button>
      {!effectiveCollapsed && (
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
