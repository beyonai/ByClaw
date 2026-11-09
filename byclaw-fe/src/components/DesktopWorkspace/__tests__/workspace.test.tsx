import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DesktopWorkspace from '../index';
import { registerDesktops, useDesktopWorkspace } from '@/utils/desktopWorkspace';
const mockLookup = jest.fn();
const mockRenderedUrls: string[] = [];
let mockSnapshot: (snapshot: any) => void;
jest.mock('@/models/common/useAppStore', () => ({
  __esModule: true,
  default: { getState: () => ({ getSandboxesInfoUrl: mockLookup }) },
}));
jest.mock('@/components/MessagesComp/Iframe/IframeRender', () => ({
  __esModule: true,
  default: ({ url, onConnectionStateChange }: any) => {
    mockRenderedUrls.push(url);
    mockSnapshot = onConnectionStateChange;
    return <iframe title="desktop" src={url} />;
  },
}));
const rows = ['a', 'b'].map((sandboxId) => ({
  sandboxId,
  instanceEndpoints: { vnc: `https://${sandboxId}/vnc.html` },
}));
const refs = rows.map(({ sandboxId }) => ({ sandboxId, instance: 'vnc' }));
beforeEach(() => {
  sessionStorage.clear();
  useDesktopWorkspace.setState({ owners: {}, activeOwner: '', visible: false });
  mockLookup.mockReset().mockResolvedValue(rows);
  mockRenderedUrls.length = 0;
});
it('mounts only the selected iframe and changes only that view when switching tabs', async () => {
  registerDesktops('owner', refs);
  const view = render(<DesktopWorkspace owner="owner" />);
  expect(await screen.findByTitle('desktop')).toHaveAttribute('src', expect.stringContaining('https://a/'));
  fireEvent.click(screen.getByRole('tab', { name: /vnc · b/ }));
  await waitFor(() =>
    expect(screen.getByTitle('desktop')).toHaveAttribute('src', expect.stringContaining('https://b/'))
  );
  expect(document.querySelectorAll('iframe')).toHaveLength(1);
  view.unmount();
  expect(document.querySelectorAll('iframe')).toHaveLength(0);
});
it('keeps old-image unknown status usable and parent reconnect obtains a new authorized URL', async () => {
  registerDesktops('owner', [refs[0]]);
  render(<DesktopWorkspace owner="owner" />);
  await screen.findByTitle('desktop');
  act(() => mockSnapshot({ state: 'unknown' }));
  expect(screen.getByText('状态未上报')).toBeInTheDocument();
  mockLookup.mockResolvedValue([{ ...rows[0], instanceEndpoints: { vnc: 'https://a/vnc.html?token=renewed' } }]);
  fireEvent.click(screen.getByRole('button', { name: '重新连接' }));
  await waitFor(() =>
    expect(screen.getByTitle('desktop')).toHaveAttribute('src', expect.stringContaining('token=renewed'))
  );
  expect(mockLookup).toHaveBeenCalledTimes(2);
});
it('keeps an empty authorized directory reachable without tool refs', async () => {
  mockLookup.mockResolvedValue([]);
  render(<DesktopWorkspace owner="empty" />);
  expect(await screen.findByText('从全部桌面添加当前会话的远程桌面')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '全部桌面' }));
  expect(await screen.findByRole('menu')).toBeInTheDocument();
  expect(document.querySelectorAll('iframe')).toHaveLength(0);
});
it('adds and selects a desktop from the authorized directory menu', async () => {
  registerDesktops('owner', [refs[0]]);
  render(<DesktopWorkspace owner="owner" />);
  expect(await screen.findByTitle('desktop')).toHaveAttribute('src', expect.stringContaining('https://a/'));
  expect(screen.queryByRole('tab', { name: /vnc · b/ })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '全部桌面' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'vnc · b' }));

  await waitFor(() =>
    expect(screen.getByTitle('desktop')).toHaveAttribute('src', expect.stringContaining('https://b/'))
  );
  expect(screen.getByRole('tab', { name: /vnc · b/ })).toHaveAttribute('aria-selected', 'true');
  expect(document.querySelectorAll('iframe')).toHaveLength(1);
});
it.each([
  { sandboxType: 'byclaw-dsh', expected: 'byclaw-dsh' },
  { sandboxType: '', expected: 'a' },
  {
    sandboxType: 'shared-host',
    isShared: true,
    mappingId: 'mapping-a',
    serviceKey: 'shared-browser',
    expected: 'shared-browser',
  },
])(
  'shows the sandbox name with its full identity in the directory tooltip: $expected',
  async ({ expected, ...row }) => {
    mockLookup.mockResolvedValue([{ ...rows[0], ...row }]);
    render(<DesktopWorkspace owner="empty" />);
    await screen.findByText('从全部桌面添加当前会话的远程桌面');
    fireEvent.click(screen.getByRole('button', { name: '全部桌面' }));
    expect(await screen.findByTitle('a')).toHaveTextContent(expected);
  }
);
it('keeps same-named sandbox groups distinct when selecting a desktop', async () => {
  mockLookup.mockResolvedValue(rows.map((row) => ({ ...row, sandboxType: 'byclaw-dsh' })));
  render(<DesktopWorkspace owner="empty" />);
  await screen.findByText('从全部桌面添加当前会话的远程桌面');
  fireEvent.click(screen.getByRole('button', { name: '全部桌面' }));
  expect(await screen.findByTitle('a')).toHaveTextContent('byclaw-dsh');
  expect(screen.getByTitle('b')).toHaveTextContent('byclaw-dsh');
  fireEvent.click(screen.getByRole('menuitem', { name: 'vnc · byclaw-dsh (b)' }));
  expect(await screen.findByTitle('desktop')).toHaveAttribute('src', expect.stringContaining('https://b/'));
});
it('does not remount the current B desktop when closing background tab A', async () => {
  const third = { sandboxId: 'c', instanceEndpoints: { vnc: 'https://c/vnc.html' } };
  mockLookup.mockResolvedValue([...rows, third]);
  registerDesktops('owner', [...refs, { sandboxId: 'c', instance: 'vnc' }]);
  const { selectDesktop } = require('@/utils/desktopWorkspace');
  selectDesktop('owner', refs[1]);
  render(<DesktopWorkspace owner="owner" />);
  const frame = await screen.findByTitle('desktop');
  expect(frame).toHaveAttribute('src', expect.stringContaining('https://b/'));
  const background = screen.getByText('vnc · c').closest('.ant-tabs-tab')!;
  fireEvent.click(background.querySelector('button')!);
  expect(screen.getByTitle('desktop')).toBe(frame);
  expect(screen.getByTitle('desktop')).toHaveAttribute('src', expect.stringContaining('https://b/'));
});
it('selects the right neighbor when closing the active middle desktop', async () => {
  const third = { sandboxId: 'c', instanceEndpoints: { vnc: 'https://c/vnc.html' } };
  mockLookup.mockResolvedValue([...rows, third]);
  registerDesktops('owner', [...refs, { sandboxId: 'c', instance: 'vnc' }]);
  const { selectDesktop } = require('@/utils/desktopWorkspace');
  selectDesktop('owner', refs[1]);
  render(<DesktopWorkspace owner="owner" />);
  expect(await screen.findByTitle('desktop')).toHaveAttribute('src', expect.stringContaining('https://b/'));

  const activeTab = screen.getByRole('tab', { name: /vnc · b/ }).closest('.ant-tabs-tab')!;
  fireEvent.click(activeTab.querySelector('button')!);

  await waitFor(() =>
    expect(screen.getByTitle('desktop')).toHaveAttribute('src', expect.stringContaining('https://c/'))
  );
  expect(screen.getByRole('tab', { name: /vnc · c/ })).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByRole('tab', { name: /vnc · b/ })).not.toBeInTheDocument();
});
it('reopens the last closed desktop from the authorized directory', async () => {
  mockLookup.mockResolvedValue([rows[0]]);
  registerDesktops('owner', [refs[0]]);
  render(<DesktopWorkspace owner="owner" />);
  await screen.findByTitle('desktop');

  const lastTab = screen.getByRole('tab', { name: /vnc · a/ }).closest('.ant-tabs-tab')!;
  fireEvent.click(lastTab.querySelector('button')!);

  expect(await screen.findByText('从全部桌面添加当前会话的远程桌面')).toBeInTheDocument();
  expect(screen.queryByTitle('desktop')).not.toBeInTheDocument();
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '全部桌面' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'vnc · a' }));

  expect(await screen.findByTitle('desktop')).toHaveAttribute('src', expect.stringContaining('https://a/'));
  expect(screen.getByRole('tab', { name: /vnc · a/ })).toHaveAttribute('aria-selected', 'true');
});
it('never mounts old authorization while a new selected view or reconnect is unresolved', async () => {
  registerDesktops('owner', refs);
  render(<DesktopWorkspace owner="owner" />);
  await screen.findByTitle('desktop');
  let resolve!: (rows: any[]) => void;
  mockLookup.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  mockRenderedUrls.length = 0;
  fireEvent.click(screen.getByRole('tab', { name: /vnc · b/ }));
  expect(mockRenderedUrls).not.toEqual(expect.arrayContaining([expect.stringContaining('https://a/')]));
  expect(screen.queryByTitle('desktop')).not.toBeInTheDocument();
  await act(async () => resolve(rows));
  await screen.findByTitle('desktop');
  mockLookup.mockReturnValue(new Promise(() => {}));
  mockRenderedUrls.length = 0;
  fireEvent.click(screen.getByRole('button', { name: '重新连接' }));
  expect(mockRenderedUrls).not.toEqual(expect.arrayContaining([expect.stringContaining('https://b/')]));
  expect(screen.queryByTitle('desktop')).not.toBeInTheDocument();
});

it('keeps a missing desktop unavailable at the deadline without misreporting successful directory requests', async () => {
  jest.useFakeTimers();
  try {
    mockLookup.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve([rows[1]]), 100)));
    registerDesktops('owner', [refs[0]]);
    const view = render(<DesktopWorkspace owner="owner" />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(62000);
    });
    expect(screen.queryByText('无法获取授权桌面清单，请重试')).not.toBeInTheDocument();
    expect(
      screen.getByText('该桌面实例当前不可用，可能已释放或不再授权；可从“全部桌面”选择其他实例')
    ).toBeInTheDocument();
    expect(screen.getByText('实例不可用')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /vnc · a/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTitle('desktop')).not.toBeInTheDocument();
    const countAtDeadline = mockLookup.mock.calls.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10000);
    });
    expect(mockLookup).toHaveBeenCalledTimes(countAtDeadline);
    fireEvent.click(screen.getByRole('button', { name: '全部桌面' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'vnc · b' }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByTitle('desktop')).toHaveAttribute('src', expect.stringContaining('https://b/'));
    expect(screen.getByRole('tab', { name: /vnc · a/ })).toBeInTheDocument();
    view.unmount();
  } finally {
    jest.useRealTimers();
  }
});
it('does not start another directory request after the preparation deadline', async () => {
  jest.useFakeTimers();
  try {
    const started = Date.now();
    const requestTimes: number[] = [];
    mockLookup.mockImplementation(() => {
      requestTimes.push(Date.now() - started);
      return new Promise((resolve) => setTimeout(() => resolve([]), 100));
    });
    registerDesktops('owner', [refs[0]]);
    const view = render(<DesktopWorkspace owner="owner" />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(62000);
    });
    expect(requestTimes.every((time) => time < 60000)).toBe(true);
    expect(screen.queryByText('无法获取授权桌面清单，请重试')).not.toBeInTheDocument();
    view.unmount();
  } finally {
    jest.useRealTimers();
  }
});
it('still reports a real directory failure and allows manual retry to restore the same identity', async () => {
  mockLookup.mockRejectedValueOnce(new Error('directory unavailable'));
  registerDesktops('owner', [refs[0]]);
  render(<DesktopWorkspace owner="owner" />);
  expect(await screen.findByText('无法获取授权桌面清单，请重试')).toBeInTheDocument();
  expect(screen.queryByText('实例不可用')).not.toBeInTheDocument();
  mockLookup.mockResolvedValueOnce([rows[0]]);
  fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
  expect(await screen.findByTitle('desktop')).toHaveAttribute('src', expect.stringContaining('https://a/'));
});
it('keeps waiting for a newly allocated desktop that appears before the deadline', async () => {
  jest.useFakeTimers();
  try {
    mockLookup.mockResolvedValueOnce([]).mockResolvedValue(rows);
    registerDesktops('owner', [refs[0]]);
    const view = render(<DesktopWorkspace owner="owner" />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2200);
    });
    expect(screen.getByTitle('desktop')).toHaveAttribute('src', expect.stringContaining('https://a/'));
    expect(screen.queryByText('实例不可用')).not.toBeInTheDocument();
    view.unmount();
  } finally {
    jest.useRealTimers();
  }
});

it('reports entry timeout when a known desktop stays unready until the directory budget expires', async () => {
  jest.useFakeTimers();
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ status: 503 });
  try {
    const directory = [{ ...rows[0], instanceEndpoints: { vnc: '/desktop/vnc.html' } }];
    mockLookup.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(directory), 2500)));
    registerDesktops('owner', [refs[0]]);
    const view = render(<DesktopWorkspace owner="owner" />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(62000);
    });
    expect(screen.queryByText('无法获取授权桌面清单，请重试')).not.toBeInTheDocument();
    expect(screen.getByText('暂时无法获取访问入口，请重新连接')).toBeInTheDocument();
    expect(screen.queryByText('实例不可用')).not.toBeInTheDocument();
    expect(screen.queryByTitle('desktop')).not.toBeInTheDocument();
    view.unmount();
  } finally {
    global.fetch = originalFetch;
    jest.useRealTimers();
  }
});
