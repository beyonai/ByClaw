import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ChatResourceWorkspace from '..';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ locale: 'zh-CN', formatMessage: ({ id }: { id: string }) => id }),
}));
jest.mock('@/hooks/useChatRuntime', () => ({
  useChatRuntime: () => ({ runtimeType: 'dsh', runtimeReady: true }),
}));
jest.mock('@/layout/sider/components/ActiveSiderAgentBar', () => ({ useActiveSiderAgent: () => ({}) }));
jest.mock('@/utils/agent', () => ({ getAgentChatAvatar: () => null }));
jest.mock('../useChatResourceProject', () => ({ useChatResourceProject: () => ({ loading: false }) }));
jest.mock('../useSessionDataSourcesVisible', () => ({ useSessionDataSourcesVisible: () => false }));
jest.mock('../useResourceAttachmentPreview', () => ({ __esModule: true, default: () => undefined }));
jest.mock('@/service/projectDataSources', () => ({ querySessionDataSources: jest.fn() }));
jest.mock('@/layout/sider/components/FileSiderPanel/utils', () => ({ isDirectory: () => false }));
jest.mock('@/components/ProjectDataSources', () => () => null);
jest.mock('../FileResourcePanel', () => () => <div>Resource files</div>);
jest.mock('@/layout/sider/components/Knowledge', () => () => null);
jest.mock('@/layout/sider/components/ModelSiderPanel', () => () => null);
jest.mock('@/layout/sider/components/ResourceSiderPanel', () => () => null);

function Workspace({ preview }: { preview: boolean }) {
  const [listOpen, setListOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setListOpen(true)}>
        Reopen resources
      </button>
      {(listOpen || preview) && (
        <ChatResourceWorkspace
          sessionId="session-a"
          listOpen={listOpen}
          tabs={preview ? [{ key: 'file:a', title: 'report', content: <div>File preview</div> }] : []}
          activeTabKey={preview ? 'file:a' : ''}
          onToggleList={() => setListOpen((open) => !open)}
          onOpenDetail={jest.fn()}
          onActiveTabChange={jest.fn()}
          onCloseTab={jest.fn()}
          onCloseTabs={jest.fn()}
        />
      )}
    </>
  );
}

it.each([false, true])('closes the resource list and preserves an existing preview (preview=%p)', (preview) => {
  render(<Workspace preview={preview} />);
  const resourceList = screen.getByText('Resource files').closest('aside');
  fireEvent.click(screen.getByRole('button', { name: 'chatResource.closeList' }));

  expect(screen.queryByText('File preview') !== null).toBe(preview);
  expect(document.body.contains(resourceList)).toBe(preview);
  expect(resourceList?.getAttribute('aria-hidden')).toBe(String(preview));
  fireEvent.click(screen.getByRole('button', { name: 'Reopen resources' }));
  expect(screen.getByRole('button', { name: 'chatResource.closeList' })).toBeVisible();
  expect(screen.getByText('Resource files').closest('aside')).toHaveAttribute('aria-hidden', 'false');
});
