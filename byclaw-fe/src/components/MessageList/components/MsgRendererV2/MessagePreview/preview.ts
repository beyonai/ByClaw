import type { ReactNode } from 'react';
import type { IMessageListItem } from '@/typescript/message';

export const getThinkingPreview = (items: IMessageListItem[], ended: boolean): ReactNode => {
  const lines = items
    .map((item) => item.content?.substance)
    .filter((substance): substance is string => typeof substance === 'string')
    .flatMap((substance) => substance.split(/\r?\n/))
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const preview = (ended ? lines[0] : lines[lines.length - 1]) || '';
  return preview.length > 120 ? `${preview.slice(0, 120)}…` : preview;
};

export const getPreviewItem = (items: IMessageListItem[], ended: boolean) => {
  const previewableItems = items.filter(
    ({ content }) => content?.substance !== null && content?.substance !== undefined
  );
  return ended ? previewableItems[0] : previewableItems[previewableItems.length - 1];
};
