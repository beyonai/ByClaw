import { localizeNotification } from '../notificationI18n';

describe('localizeNotification', () => {
  const intl = {
    formatMessage: ({ id }: { id: string }, values?: Record<string, any>) => `${id}:${values?.packageName || ''}`,
  };

  it('resolves notification title and content from extraInfo message ids', () => {
    const result = localizeNotification(
      {
        title: 'fallback title',
        content: 'fallback content',
        extraInfo: JSON.stringify({
          titleMessageId: 'storageQuota.notification.granted.title',
          contentMessageId: 'storageQuota.notification.granted.content',
          messageValues: { packageName: '1GB' },
        }),
      },
      intl
    );

    expect(result.title).toBe('storageQuota.notification.granted.title:1GB');
    expect(result.content).toBe('storageQuota.notification.granted.content:1GB');
  });

  it('keeps fallback text when extraInfo is invalid', () => {
    const notification = { title: 'fallback title', content: 'fallback content', extraInfo: '{invalid' };
    expect(localizeNotification(notification, intl)).toBe(notification);
  });
});
