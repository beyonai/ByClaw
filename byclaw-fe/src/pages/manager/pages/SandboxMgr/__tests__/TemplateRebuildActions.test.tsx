import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { nanoid } from 'nanoid';
import { startTemplateRebuild, listTemplateRebuildRecords } from '@/pages/manager/service/TemplateRebuild';
import TemplateRebuildActions from '../TemplateRebuildActions';

jest.mock('@/pages/manager/service/TemplateRebuild', () => ({
  startTemplateRebuild: jest.fn(),
  listTemplateRebuildRecords: jest.fn(),
}));
jest.mock('nanoid', () => ({ nanoid: jest.fn(() => 'stable-request-1234567890') }));

describe('MicroVM template actions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('hides both actions for unsupported engines', () => {
    render(<TemplateRebuildActions serviceKey="byclaw-dsh" supported={false} />);
    expect(screen.queryByRole('button', { name: '重建模板' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重建模板记录' })).not.toBeInTheDocument();
  });

  it('shows operator/time/service audit fields and requests server pagination', async () => {
    (listTemplateRebuildRecords as jest.Mock).mockResolvedValue({
      total: 21,
      records: [
        {
          id: 'one',
          actorName: '真实管理员',
          serviceName: 'DSH服务规格',
          serviceKey: 'byclaw-dsh',
          createdAt: 1793330000000,
          state: 'SUCCEEDED',
        },
      ],
    });
    render(<TemplateRebuildActions serviceKey="byclaw-dsh" supported />);
    fireEvent.click(screen.getByRole('button', { name: '重建模板记录' }));
    await screen.findByText('真实管理员');
    expect(screen.getByText('DSH服务规格')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader', { name: '操作时间' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('columnheader', { name: '操作用户名称' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('columnheader', { name: '沙箱服务规格名称' }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTitle('2'));
    await waitFor(() => expect(listTemplateRebuildRecords).toHaveBeenLastCalledWith('byclaw-dsh', 2, 10));
  });

  it('retains the idempotency key after an uncertain submission failure', async () => {
    (startTemplateRebuild as jest.Mock)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ id: 'one', state: 'NEW' });
    (listTemplateRebuildRecords as jest.Mock).mockResolvedValue({ total: 0, records: [] });
    render(<TemplateRebuildActions serviceKey="byclaw-dsh" supported />);
    fireEvent.click(screen.getByRole('button', { name: '重建模板' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认重建' }));
    await waitFor(() => expect(startTemplateRebuild).toHaveBeenCalledTimes(1));
    await screen.findByText('network');
    fireEvent.click(screen.getByRole('button', { name: '确认重建' }));
    await waitFor(() => expect(startTemplateRebuild).toHaveBeenCalledTimes(2));
    expect(nanoid).toHaveBeenCalledTimes(1);
    expect((startTemplateRebuild as jest.Mock).mock.calls[0]).toEqual(
      (startTemplateRebuild as jest.Mock).mock.calls[1]
    );
  });

  it('continues polling pending records after a temporary read failure and stops after completion', async () => {
    jest.useFakeTimers();
    const record = {
      id: 'one',
      serviceKey: 'byclaw-dsh',
      serviceName: 'DSH服务规格',
      actorName: '真实管理员',
      createdAt: 1793330000000,
      state: 'BUILDING',
    };
    (listTemplateRebuildRecords as jest.Mock)
      .mockResolvedValueOnce({ total: 1, records: [record] })
      .mockRejectedValueOnce(new Error('temporary read failure'))
      .mockResolvedValue({ total: 1, records: [{ ...record, state: 'SUCCEEDED' }] });
    const view = render(<TemplateRebuildActions serviceKey="byclaw-dsh" supported />);
    try {
      fireEvent.click(screen.getByRole('button', { name: '重建模板记录' }));
      await act(async () => {});
      expect(screen.getByText('构建中')).toBeInTheDocument();
      await act(async () => jest.advanceTimersByTime(5000));
      expect(screen.getByText('temporary read failure')).toBeInTheDocument();
      await act(async () => jest.advanceTimersByTime(5000));
      expect(listTemplateRebuildRecords).toHaveBeenCalledTimes(3);
      expect(screen.getByText('已完成')).toBeInTheDocument();
      expect(screen.queryByText('temporary read failure')).not.toBeInTheDocument();
      await act(async () => jest.advanceTimersByTime(10000));
      expect(listTemplateRebuildRecords).toHaveBeenCalledTimes(3);
    } finally {
      view.unmount();
      jest.useRealTimers();
    }
  });
});
