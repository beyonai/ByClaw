import type { ReactNode } from 'react';
import { act, renderHook, within } from '@testing-library/react';

import IframeRender from '@/components/MessagesComp/Iframe/IframeRender';
import useCodeActions from './useActions';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));
jest.mock('@/hooks/useGlobal', () => () => ({
  EventEmitter: { emit: jest.fn() },
  sessionId: 'session',
  layoutMode: 'common',
}));
jest.mock('@/service/message', () => ({ collectCase: jest.fn(), cancelCollectCase: jest.fn() }));
jest.mock('@/utils/file', () => ({ downloadFile: jest.fn() }));
jest.mock('../imageExtension', () => ({ toggleImageCollected: jest.fn(), loadingStarHtml: '' }));
jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('@ant-design/icons', () => ({ PlayCircleOutlined: () => null, CodeOutlined: () => null }));
jest.mock('@/components/MessagesComp/Iframe/IframeRender', () => ({
  __esModule: true,
  default: jest.fn(({ url, autoHeight }: { url: string; autoHeight: boolean }) => (
    <iframe title="HTML preview" src={url} data-auto-height={String(autoHeight)} />
  )),
}));
jest.mock('antd', () => {
  const { Children, isValidElement } = jest.requireActual('react');
  const Tabs = ({ children, activeKey }: { children: ReactNode; activeKey: string }) => (
    <div>
      {Children.map(children, (child: ReactNode) => (isValidElement(child) && child.key === activeKey ? child : null))}
    </div>
  );
  Tabs.TabPane = ({ children }: { children: ReactNode }) => <>{children}</>;

  return {
    App: { useApp: () => ({ message: { success: jest.fn() } }) },
    Button: ({ onClick }: { onClick: () => void }) => (
      <button type="button" onClick={onClick}>
        Copy
      </button>
    ),
    Segmented: ({ value }: { value: string }) => <div role="group" aria-label="code view" data-value={value} />,
    Spin: () => <div role="status">Loading</div>,
    Tabs,
  };
});

describe('useCodeActions HTML streaming', () => {
  it('mounts an automatic-height iframe and enables run controls only after the message is done', () => {
    const html = '<p>streamed HTML</p>';
    const container = document.createElement('div');
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.className = 'html language-html';
    code.textContent = html;
    Object.defineProperty(code, 'innerText', { get: () => code.textContent || '' });
    pre.appendChild(code);
    container.appendChild(pre);
    document.body.appendChild(container);

    const wrap = { current: container };
    const hookContainer = document.createElement('div');
    const createRoot = jest.spyOn(jest.requireActual('react-dom/client'), 'createRoot');
    const originalCreateObjectURL = URL.createObjectURL;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: jest.fn(() => 'blob:streamed-html'),
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});

    const { rerender, unmount } = renderHook(({ isMessageDone }) => useCodeActions({ wrap, isMessageDone }), {
      initialProps: { isMessageDone: false },
      container: hookContainer,
    });

    try {
      expect(within(container).getByText(html)).toBeInTheDocument();
      expect(within(container).queryByTitle('HTML preview')).not.toBeInTheDocument();
      expect(within(container).queryByRole('group', { name: 'code view' })).not.toBeInTheDocument();
      expect(IframeRender).not.toHaveBeenCalled();

      code.textContent = html;
      rerender({ isMessageDone: true });

      expect(within(container).getByTitle('HTML preview')).toHaveAttribute('data-auto-height', 'true');
      expect(within(container).getByTitle('HTML preview')).toHaveAttribute('src', 'blob:streamed-html');
      expect(within(container).getByRole('group', { name: 'code view' })).toHaveAttribute('data-value', 'run');
    } finally {
      act(() => {
        createRoot.mock.calls.forEach(([rootContainer], index) => {
          if (rootContainer !== hookContainer) {
            createRoot.mock.results[index].value.unmount();
          }
        });
      });
      unmount();
      container.remove();
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL });
      jest.restoreAllMocks();
    }
  });
});
