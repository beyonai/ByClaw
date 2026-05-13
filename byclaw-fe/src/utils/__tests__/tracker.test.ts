jest.mock('@/service/common/request', () => ({
  POST: jest.fn(),
}));

jest.mock('@/utils/math', () => ({
  generateUniqueId: jest.fn(() => 'abc123'),
}));

import { POST } from '@/service/common/request';
import TrackerInstance, { Tracker, getTrackerInfo } from '@/utils/tracker';

const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('utils/tracker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    Object.defineProperty(window, 'location', {
      value: { href: 'https://example.com/page' },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('getTrackerInfo builds elementId from elementCode and generated id', () => {
    expect(getTrackerInfo('headerEmployeeClick', { objectId: '1' })).toMatchObject({
      elementCode: 'header_agent_redirect',
      elementId: 'header_agent_redirect_abc123',
      objectId: '1',
    });
  });

  it('track queues event and send uses beacon when available', () => {
    const tracker = new Tracker();
    const sendBeacon = jest.fn(() => true);
    Object.defineProperty(window.navigator, 'sendBeacon', {
      value: sendBeacon,
      configurable: true,
    });

    tracker.track('CLICK', { objectId: '1' } as any);
    tracker.send();

    expect(sendBeacon).toHaveBeenCalled();
    expect(tracker.queue).toHaveLength(0);
  });

  it('send falls back to POST and requeues on failure', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const tracker = new Tracker();
      Object.defineProperty(window.navigator, 'sendBeacon', {
        value: undefined,
        configurable: true,
      });
      mockPOST.mockRejectedValue(new Error('failed'));

      tracker.track('CLICK', { objectId: '1' } as any);
      tracker.send();

      await Promise.resolve();
      await Promise.resolve();

      expect(mockPOST).toHaveBeenCalledWith(
        '/byaiService/trackLogController/batchSaveTrackLog',
        expect.objectContaining({
          trackLogs: [expect.objectContaining({ objectId: '1' })],
        }),
        {
          responseCfg: {
            hideErrorTips: true,
          },
        }
      );
      expect(tracker.queue).toHaveLength(1);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('clear empties queue and singleton exists', () => {
    const tracker = new Tracker();
    tracker.track('CLICK', { objectId: '1' } as any);
    tracker.clear();
    expect(tracker.queue).toEqual([]);
    expect(TrackerInstance).toBeDefined();
  });
});
