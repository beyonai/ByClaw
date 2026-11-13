import React, { type ReactNode, useEffect, useMemo, useState } from 'react';
import classnames from 'classnames';
import type { IMessage, IMessageListItem } from '@/typescript/message';
import { loadThinkingPreviewGetter } from '../thinkingPreviewHandler';
import { getPreviewItem, getThinkingPreview } from './preview';
import styles from './index.module.less';

type Props = {
  items: IMessageListItem[];
  message: IMessage;
  ended?: boolean;
  className?: string;
  fallback?: ReactNode;
};

/** Shared one-line preview: contentType selects the renderer, regardless of the stream channel. */
export default function MessagePreview({ items, message, ended = false, className, fallback = null }: Props) {
  const defaultPreview = useMemo(() => getThinkingPreview(items, ended), [items, ended]);
  const previewItem = useMemo(() => getPreviewItem(items, ended), [items, ended]);
  const [custom, setCustom] = useState<{ item: IMessageListItem; message: IMessage; value: ReactNode }>();
  // Never render an asynchronous result belonging to the previous item or run, even for one paint.
  const preview = custom && custom.item === previewItem && custom.message === message ? custom.value : defaultPreview;
  useEffect(() => {
    let active = true;
    if (previewItem) {
      loadThinkingPreviewGetter(previewItem.contentType).then((getPreview) => {
        if (!active || !getPreview) return;
        const value = getPreview({ message, messageListItemContent: previewItem.content, thinkListItem: previewItem });
        if (value !== null && value !== undefined) setCustom({ item: previewItem, message, value });
      });
    }
    return () => {
      active = false;
    };
  }, [message, previewItem]);
  if (preview === null || preview === undefined || preview === '') return <>{fallback}</>;
  return (
    <span className={classnames(styles.preview, className)} title={typeof preview === 'string' ? preview : undefined}>
      {preview}
    </span>
  );
}
