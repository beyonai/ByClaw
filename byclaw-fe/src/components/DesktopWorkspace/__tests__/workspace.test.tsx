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
  expect(screen.getByRole('combobox', { name: '全部桌面' })).toBeInTheDocument();
  expect(await screen.findByText('从全部桌面添加当前会话的远程桌面')).toBeInTheDocument();
  expect(document.querySelectorAll('iframe')).toHaveLength(0);
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
