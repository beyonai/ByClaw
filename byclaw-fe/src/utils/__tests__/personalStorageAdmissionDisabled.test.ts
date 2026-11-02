jest.mock('@umijs/max', () => ({ getIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));
jest.mock('antd', () => ({ Modal: { info: jest.fn(), error: jest.fn(), confirm: jest.fn() } }));
jest.mock('../auth', () => ({ getAuthSnapshot: jest.fn(() => ({})), isCurrentAuthSnapshot: () => true }));
jest.mock('../websocket', () => ({
  __esModule: true,
  default: {
    getScopedSessionId: () => 'test-session',
    onMessage: jest.fn(),
    offMessage: jest.fn(),
    onReconnect: () => () => {},
    waitUntilConnected: () => Promise.resolve(),
  },
}));
jest.mock('@/service/common/request', () => ({
  POST: jest.fn(() => Promise.resolve({ enabled: false, ready: true, state: 'DISABLED' })),
}));

import { Modal } from 'antd';
import { POST } from '@/service/common/request';
import { getAuthSnapshot } from '../auth';
import { requiresPersonalStorage, waitForPersonalStorage } from '../personalStorageReadiness';
import { NasReadinessCancelled } from '../nasReadinessWaiter';

describe('disabled personal storage admission', () => {
  it('dispatches without a readiness request, auth capture, waiting dialog or storage version requirement', async () => {
    Object.assign(globalThis, { PERSONAL_STORAGE_ADMISSION_ENABLED: false });
    (POST as jest.Mock).mockResolvedValue({ enabled: true, ready: false, state: 'WAITING_QUOTA' });
    await waitForPersonalStorage();
    expect(POST).not.toHaveBeenCalled();
    expect(getAuthSnapshot).not.toHaveBeenCalled();
    expect(Modal.info).not.toHaveBeenCalled();
    expect(requiresPersonalStorage('/byaiService/fileBrowser/upload')).toBe(false);
    expect(requiresPersonalStorage('/byaiService/chat/uploadFiles')).toBe(false);
  });

  it('does not turn cancellation into permission to dispatch', async () => {
    Object.assign(globalThis, { PERSONAL_STORAGE_ADMISSION_ENABLED: false });
    const controller = new AbortController();
    controller.abort();
    await expect(waitForPersonalStorage(controller.signal)).rejects.toBeInstanceOf(NasReadinessCancelled);
  });
});
