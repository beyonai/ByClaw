import { EventEmitter } from 'events';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { useState } from 'react';
import { Drawer } from 'antd';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import MainDrawer from '../index';
import layoutStyles from '@/layout/pcLayout/index.module.less';

const mockEventEmitter = new EventEmitter();

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ EventEmitter: mockEventEmitter }),
}));

jest.mock('@/components/MessagesComp/Iframe/IframeRender', () => ({
  __esModule: true,
  default: function RemoteDesktopBoundary() {
    const [clicks, setClicks] = require('react').useState(0);
    return (
      <button type="button" aria-label="remote session" onClick={() => setClicks((count: number) => count + 1)}>
        Remote clicks: {clicks}
      </button>
    );
  },
}));

jest.mock('@/components/Preview/Twins', () => ({ PreViewFile: () => null }));
jest.mock('@/pages/mobile/AuthPage', () => ({ __esModule: true, default: () => null }));

const LayeringHarness = ({ accountPanel = false }: { accountPanel?: boolean }) => {
  const [globalDrawerOpen, setGlobalDrawerOpen] = useState(false);
  return (
    <>
      <div className={layoutStyles.layout} style={{ display: 'flex', height: 600 }}>
        <button type="button" onClick={() => setGlobalDrawerOpen(true)}>
          Open global drawer
        </button>
        {accountPanel && (
          <aside
            className={`${layoutStyles.detailPanel} ${layoutStyles.detailPanelOverlay}`}
            data-testid="account-panel"
          >
            Operation accounts
          </aside>
        )}
        <MainDrawer />
      </div>
      <Drawer open={globalDrawerOpen} title="Trace details" onClose={() => setGlobalDrawerOpen(false)}>
        Trace content
      </Drawer>
    </>
  );
};

const openRemoteDesktop = (overlay = false) => {
  act(() => {
    mockEventEmitter.emit('beyond-main-driver-open-type', {
      drawerType: 'vnc',
      title: 'Remote desktop',
      canClose: true,
      width: '50vw',
      overlay,
    });
    mockEventEmitter.emit('beyond-main-driver-message', { url: '/remote-session' });
  });
};

const stackingLevel = (element: Element) => {
  const value = window.getComputedStyle(element).zIndex;
  return value && value !== 'auto' ? Number(value) : 0;
};

describe('MainDrawer layering', () => {
  let compiledStyles: HTMLStyleElement;

  beforeAll(async () => {
    const frontendRoot = resolve(__dirname, '../../../..');
    const pnpmDirectory = resolve(frontendRoot, 'node_modules/.pnpm');
    const lessPackage = readdirSync(pnpmDirectory).find((name) => name.startsWith('less@'));
    if (!lessPackage) throw new Error('The installed Umi dependencies must include Less');
    const less = require(resolve(pnpmDirectory, lessPackage, 'node_modules/less'));
    const stylePaths = [
      resolve(__dirname, '../index.module.less'),
      resolve(frontendRoot, 'src/layout/pcLayout/index.module.less'),
    ];
    const styles = await Promise.all(
      stylePaths.map(async (filename) => (await less.render(readFileSync(filename, 'utf8'), { filename })).css)
    );
    compiledStyles = document.createElement('style');
    compiledStyles.textContent = styles.join('\n');
    document.head.appendChild(compiledStyles);
  });

  beforeEach(() => mockEventEmitter.removeAllListeners());
  afterAll(() => compiledStyles?.remove());

  it('keeps an inline remote desktop below a global Drawer', () => {
    render(<LayeringHarness />);
    openRemoteDesktop();
    fireEvent.click(screen.getByRole('button', { name: 'Open global drawer' }));

    const remotePanel = screen.getByRole('button', { name: 'remote session' }).closest('.myDrawer')!;
    const globalDrawer = screen.getByText('Trace content').closest('.ant-drawer')!;
    expect(stackingLevel(globalDrawer)).toBeGreaterThan(0);
    expect(stackingLevel(remotePanel)).toBeLessThan(stackingLevel(globalDrawer));
  });

  it('preserves the remote session when a global Drawer closes', async () => {
    render(<LayeringHarness />);
    openRemoteDesktop();
    const remoteSession = screen.getByRole('button', { name: 'remote session' });
    fireEvent.click(remoteSession);
    fireEvent.click(screen.getByRole('button', { name: 'Open global drawer' }));
    const globalDrawer = screen.getByText('Trace content').closest('.ant-drawer')!;
    fireEvent.click(within(globalDrawer as HTMLElement).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(globalDrawer).not.toHaveClass('ant-drawer-open'));

    expect(screen.getByRole('button', { name: 'remote session' })).toBe(remoteSession);
    expect(remoteSession).toHaveTextContent('Remote clicks: 1');
    fireEvent.click(remoteSession);
    expect(remoteSession).toHaveTextContent('Remote clicks: 2');
  });

  it('keeps account login above the account panel and closes only the remote desktop', async () => {
    render(<LayeringHarness accountPanel />);
    const accountPanel = screen.getByTestId('account-panel');
    openRemoteDesktop(true);

    const overlayDrawer = screen.getByRole('button', { name: 'remote session' }).closest('.ant-drawer')!;
    expect(stackingLevel(accountPanel)).toBeGreaterThan(0);
    expect(stackingLevel(overlayDrawer)).toBeGreaterThan(stackingLevel(accountPanel));
    fireEvent.click(within(overlayDrawer as HTMLElement).getByRole('img', { name: 'close' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'remote session' })).not.toBeInTheDocument());
    expect(screen.getByTestId('account-panel')).toBe(accountPanel);
  });
});
