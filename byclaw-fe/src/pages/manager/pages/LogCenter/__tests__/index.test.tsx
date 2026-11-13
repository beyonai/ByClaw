import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import LogCenter from '..';
import { searchLogs } from '../../../service/LogCenter';

let mockUser = { userCode: 'adminvip' };
jest.mock('@umijs/max', () => ({ useSelector: (selector: any) => selector({ user: { userInfo: mockUser } }) }));
jest.mock('@/pages/manager/utils/auth', () => ({ isAdminVip: (user: any) => user?.userCode === 'adminvip' }));
jest.mock('../../../service/LogCenter', () => ({ searchLogs: jest.fn() }));

const searchMock = searchLogs as jest.Mock;

const waitForInitialQuery = async () => {
  await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: /查\s*询/ })).toBeEnabled());
};

const submit = async () => {
  const expectedCalls = searchMock.mock.calls.length + 1;
  fireEvent.click(screen.getByRole('button', { name: /查\s*询/ }));
  await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(expectedCalls));
};

describe('Log center', () => {
  beforeEach(() => {
    mockUser = { userCode: 'adminvip' };
    searchMock.mockReset();
  });

  it('displays the module code from log attributes in the table', async () => {
    searchMock.mockResolvedValue({
      items: [
        { timestamp: 1800000000, message: '模块日志', attributes: { moduleCode: 'byclaw-be' } },
        { timestamp: 1800000001, message: '无模块日志', attributes: {} },
      ],
      complete: true,
    });
    render(<LogCenter />);
    await waitForInitialQuery();
    expect(screen.getByRole('columnheader', { name: '模块编码' })).toBeInTheDocument();
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers.indexOf('模块编码')).toBeLessThan(headers.indexOf('级别'));
    expect(screen.getByRole('cell', { name: 'byclaw-be' })).toBeInTheDocument();
    expect(screen.getByText('无模块日志')).toBeInTheDocument();
  });

  it('submits the module filter, preserves it on pagination and clears it on reset', async () => {
    searchMock.mockResolvedValue({ items: [], complete: false, nextPageToken: 'module-next-token' });
    render(<LogCenter />);
    await waitForInitialQuery();
    const moduleInput = screen.getByPlaceholderText('输入模块编码，留空查询全部模块');
    fireEvent.change(moduleInput, { target: { value: 'byclaw-be' } });
    await submit();
    await waitFor(() => expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled());
    expect(searchMock.mock.calls[1][0].moduleCode).toBe('byclaw-be');
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(3));
    expect(searchMock.mock.calls[2][0]).toEqual({
      ...searchMock.mock.calls[1][0],
      pageToken: 'module-next-token',
    });
    await waitFor(() => expect(screen.getByRole('button', { name: /重\s*置/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /重\s*置/ }));
    expect(screen.getByPlaceholderText('输入模块编码，留空查询全部模块')).toHaveValue('');
    await submit();
    expect(searchMock.mock.calls[3][0].moduleCode).toBeUndefined();
  });

  it('blocks non-admin users without querying', () => {
    mockUser = { userCode: 'ordinary-user' };
    render(<LogCenter />);
    expect(screen.getByText('仅 adminvip 可查询日志')).toBeInTheDocument();
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('automatically queries once with defaults in StrictMode and after rerender', async () => {
    searchMock.mockResolvedValue({ items: [], complete: true });
    const { rerender } = render(
      <StrictMode>
        <LogCenter />
      </StrictMode>
    );
    await waitForInitialQuery();
    const initial = searchMock.mock.calls[0][0];
    expect(initial.to - initial.from).toBe(3600);
    expect(initial.pageSize).toBe(10);
    expect(initial.pageToken).toBeUndefined();
    rerender(
      <StrictMode>
        <LogCenter />
      </StrictMode>
    );
    expect(searchMock).toHaveBeenCalledTimes(1);
  });

  it('waits for the admin identity before automatically querying', async () => {
    searchMock.mockResolvedValue({ items: [], complete: true });
    mockUser = { userCode: 'ordinary-user' };
    const { rerender } = render(<LogCenter />);
    expect(searchMock).not.toHaveBeenCalled();
    mockUser = { userCode: 'adminvip' };
    rerender(<LogCenter />);
    await waitForInitialQuery();
  });
  it('passes each next token and uses saved page requests when moving backward', async () => {
    searchMock.mockResolvedValueOnce({ items: [], complete: false, nextPageToken: 'first-token' });
    searchMock.mockResolvedValueOnce({ items: [], complete: true, nextPageToken: 'second-token' });
    searchMock.mockResolvedValueOnce({ items: [], complete: true, nextPageToken: 'third-token' });
    searchMock.mockResolvedValueOnce({ items: [], complete: true, nextPageToken: 'refreshed-second-token' });
    searchMock.mockResolvedValueOnce({ items: [], complete: true, nextPageToken: 'refreshed-first-token' });
    render(<LogCenter />);
    expect(await screen.findByText('暂时没数据')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();
    await waitForInitialQuery();
    const original = searchMock.mock.calls[0][0];
    expect(original.to - original.from).toBe(3600);
    expect(original.pageSize).toBe(10);
    expect(original).not.toHaveProperty('region');
    expect(original).not.toHaveProperty('project');
    expect(original).not.toHaveProperty('logstore');
    expect(screen.queryByRole('button', { name: '重 试' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('搜索日志内容'), { target: { value: 'changed-keyword' } });
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(2));
    expect(searchMock.mock.calls[1][0]).toEqual({ ...original, pageToken: 'first-token' });
    await screen.findByText('第 2 页，本页 0 条');
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(3));
    expect(searchMock.mock.calls[2][0]).toEqual({ ...original, pageToken: 'second-token' });
    await screen.findByText('第 3 页，本页 0 条');
    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(4));
    expect(searchMock.mock.calls[3][0]).toEqual({ ...original, pageToken: 'first-token' });
    await screen.findByText('第 2 页，本页 0 条');
    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(5));
    expect(searchMock.mock.calls[4][0]).toEqual(original);
    await waitFor(() => expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled());
  });

  it('restarts from the first page without a cursor when page size changes', async () => {
    searchMock.mockResolvedValue({ items: [], complete: true, nextPageToken: 'next-token' });
    render(<LogCenter />);
    await waitForInitialQuery();
    const original = searchMock.mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await screen.findByText('第 2 页，本页 0 条');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '每页条数' }));
    fireEvent.click(await screen.findByText('50 条 / 页'));
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(3));
    expect(searchMock.mock.calls[2][0]).toEqual({ ...original, pageSize: 50, pageToken: undefined });
    await screen.findByText('第 1 页，本页 0 条');
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();
  });
  it('shows platform errors', async () => {
    searchMock.mockRejectedValueOnce(new Error('Log center is not configured'));
    render(<LogCenter />);
    await waitForInitialQuery();
    expect(await screen.findByText('Log center is not configured')).toBeInTheDocument();
  });

  it('keeps pagination controls available after receiving log records', async () => {
    searchMock.mockResolvedValueOnce({
      items: Array.from({ length: 100 }, (_, index) => ({
        timestamp: 1800000000 + index,
        message: `日志记录 ${index}`,
        attributes: {},
      })),
      complete: true,
      nextPageToken: 'records-next-token',
    });
    searchMock.mockResolvedValueOnce({ items: [], complete: true, nextPageToken: 'empty-next-token' });
    render(<LogCenter />);
    await waitForInitialQuery();
    expect(screen.getByText('第 1 页，本页 100 条')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(2));
    expect(searchMock.mock.calls[1][0].pageToken).toBe('records-next-token');
  });

  it('uses the selected quick time range without requiring the calendar to stay open', async () => {
    searchMock.mockResolvedValue({ items: [], complete: true });
    render(<LogCenter />);
    await waitForInitialQuery();
    fireEvent.click(screen.getByRole('button', { name: '选择时间范围' }));
    fireEvent.click(await screen.findByRole('button', { name: '5分钟' }));
    await submit();
    const selected = searchMock.mock.calls[1][0];
    expect(selected.to - selected.from).toBe(300);
  });
});
