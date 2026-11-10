import {
  getTemplateRebuildCapabilities,
  startTemplateRebuild,
  listTemplateRebuildRecords,
} from '@/pages/manager/service/TemplateRebuild';
import { listSharedConfigs, saveSharedConfig } from '@/pages/manager/service/SharedSandbox';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SharedConfigPanel from '../SharedConfig';

jest.mock('@/pages/manager/service/SharedSandbox', () => ({
  listSharedConfigs: jest.fn(),
  saveSharedConfig: jest.fn(),
  deleteSharedConfig: jest.fn(),
}));

jest.mock('@/pages/manager/service/TemplateRebuild', () => ({
  getTemplateRebuildCapabilities: jest.fn(),
  startTemplateRebuild: jest.fn(),
  listTemplateRebuildRecords: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  (getTemplateRebuildCapabilities as jest.Mock).mockResolvedValue({ supported: false });
});

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

test('shared host rebuild uses its selected profile and preserves running instances', async () => {
  (getTemplateRebuildCapabilities as jest.Mock).mockResolvedValue({ supported: true });
  (listSharedConfigs as jest.Mock).mockResolvedValue([
    { id: 'host-m', serviceKey: 'shared-host', sourceServiceKey: 'business-worker', profileKey: 'm', enabled: 1 },
  ]);
  (startTemplateRebuild as jest.Mock).mockResolvedValue({ id: 'build-m', state: 'NEW' });
  (listTemplateRebuildRecords as jest.Mock).mockResolvedValue({ total: 0, records: [] });
  render(<SharedConfigPanel />);
  fireEvent.click(await screen.findByRole('button', { name: '重建模板' }));
  expect(screen.getByText(/确认重建 shared-host/)).toHaveTextContent('shared-host / m');
  expect(screen.getByText(/当前运行实例继续使用原模板/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '确认重建' }));
  await waitFor(() => expect(startTemplateRebuild).toHaveBeenCalledWith('shared-host', expect.any(String), 'm'));
  expect(saveSharedConfig).not.toHaveBeenCalled();
});
