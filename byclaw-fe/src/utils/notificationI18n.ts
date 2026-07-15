interface IntlLike {
  formatMessage: (descriptor: { id: string }, values?: Record<string, any>) => string;
}

interface NotificationI18nMeta {
  titleMessageId?: string;
  contentMessageId?: string;
  messageValues?: Record<string, any>;
}

const parseExtraInfo = (extraInfo: unknown): NotificationI18nMeta | null => {
  if (!extraInfo) return null;
  if (typeof extraInfo === 'object') return extraInfo as NotificationI18nMeta;
  if (typeof extraInfo !== 'string') return null;
  try {
    return JSON.parse(extraInfo) as NotificationI18nMeta;
  } catch {
    return null;
  }
};

export const localizeNotification = <T extends { title?: string; content?: string; extraInfo?: unknown }>(
  notification: T,
  intl: IntlLike
): T => {
  const meta = parseExtraInfo(notification.extraInfo);
  if (!meta) return notification;

  const values = meta.messageValues && typeof meta.messageValues === 'object' ? meta.messageValues : undefined;
  return {
    ...notification,
    title: meta.titleMessageId ? intl.formatMessage({ id: meta.titleMessageId }, values) : notification.title,
    content: meta.contentMessageId ? intl.formatMessage({ id: meta.contentMessageId }, values) : notification.content,
  };
};
