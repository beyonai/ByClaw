import { notifyEasyConfirmInteraction } from './withEasyConfirm';

const mockMessageInfo = jest.fn();

jest.mock('antd', () => ({
  message: {
    info: (...args: unknown[]) => mockMessageInfo(...args),
  },
}));

describe('notifyEasyConfirmInteraction', () => {
  beforeEach(() => {
    mockMessageInfo.mockClear();
  });

  it('requests permission and defers the denied hint until the browser window becomes active', async () => {
    class NotificationMock {
      static permission: NotificationPermission = 'default';
      static requestPermission = jest.fn().mockResolvedValue('denied');
    }
    const originalNotification = window.Notification;
    Object.defineProperty(window, 'Notification', { configurable: true, value: NotificationMock });
    let hasFocus = false;
    const hasFocusSpy = jest.spyOn(document, 'hasFocus').mockImplementation(() => hasFocus);

    try {
      await notifyEasyConfirmInteraction({
        title: 'title',
        body: 'body',
        permissionDenied: 'easyConfirm.notification.permissionDenied',
        tag: 'easy-confirm-session-1-pending-1',
      });

      expect(NotificationMock.requestPermission).toHaveBeenCalledTimes(1);
      expect(mockMessageInfo).not.toHaveBeenCalled();

      hasFocus = true;
      window.dispatchEvent(new Event('focus'));
      expect(mockMessageInfo).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'easyConfirm.notification.permissionDenied' })
      );
    } finally {
      hasFocusSpy.mockRestore();
      Object.defineProperty(window, 'Notification', { configurable: true, value: originalNotification });
    }
  });
});
