import { listSharedConfigs, saveSharedConfig } from '@/pages/manager/service/SharedSandbox';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SharedConfigPanel from '../SharedConfig';

jest.mock('@/pages/manager/service/SharedSandbox', () => ({
  listSharedConfigs: jest.fn(),
  saveSharedConfig: jest.fn(),
  deleteSharedConfig: jest.fn(),
}));

test('saves a generic host, its business service alias and profile capacity', async () => {
  (listSharedConfigs as jest.Mock).mockResolvedValue([]);
  (saveSharedConfig as jest.Mock).mockResolvedValue({ id: 'c1' });
  render(<SharedConfigPanel />);
  fireEvent.click(await screen.findByRole('button', { name: /新增共享配置/ }));
  fireEvent.change(screen.getByLabelText('Service Key'), { target: { value: 'custom-host' } });
  fireEvent.change(screen.getByLabelText('业务 Service Key'), { target: { value: 'custom-worker' } });
  fireEvent.change(screen.getByLabelText('资源档位'), { target: { value: 'm' } });
  fireEvent.change(screen.getByLabelText('单实例人数上限'), { target: { value: '50' } });
  fireEvent.click(screen.getByRole('button', { name: /确.*定|OK/ }));
  await waitFor(() =>
    expect(saveSharedConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceKey: 'custom-host',
        sourceServiceKey: 'custom-worker',
        profileKey: 'm',
        maxOnlineUsers: 50,
        enabled: 0,
      })
    )
  );
});
