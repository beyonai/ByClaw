import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import mockZhCN from '@/locales/zh-CN/imageCanvas';
import mockEnUS from '@/locales/en-US/imageCanvas';
let mockLocale: 'zh-CN' | 'en-US' = 'zh-CN';
jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values: Record<string, string | number> = {}) => {
      const messages: Record<string, string> = mockLocale === 'zh-CN' ? mockZhCN : mockEnUS;
      return (messages[id] || id).replace(/\{(\w+)\}/g, (_: string, key: string) => String(values[key]));
    },
  }),
}));
import ImageArtifactGallery from './index';
import GlobalContext from '@/layout/components/provider/global';
import { downloadChatFileArtifact, resolveChatFileArtifacts } from '@/service/chatFileArtifact';
jest.mock('@/service/chatFileArtifact', () => ({
  downloadChatFileArtifact: jest.fn(),
  resolveChatFileArtifacts: jest.fn(),
}));
jest.mock('@/layout/sider/components/ActiveSiderAgentBar', () => ({
  useActiveSiderAgent: () => ({ resourceId: 'agent-1' }),
}));
const artifact = {
  path: '/.sessions/100/image/second.png',
  sourcePath: '/.sessions/100/image/second.png',
  fileName: 'second.png',
  parentImageId: 'first.png',
  title: '蓝鲸',
};
const emit = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  mockLocale = 'zh-CN';
  URL.createObjectURL = jest.fn(() => 'blob:image');
  URL.revokeObjectURL = jest.fn();
  (downloadChatFileArtifact as jest.Mock).mockResolvedValue({
    file: new Blob(['png'], { type: 'image/png' }),
    fileName: 'second.png',
  });
  (resolveChatFileArtifacts as jest.Mock).mockResolvedValue([
    { ...artifact, path: '/.sessions/100/image/first.png', fileName: 'first.png', parentImageId: undefined },
  ]);
});
test('opens authenticated canvas, zooms, and sends an explicit original reference to the composer', async () => {
  const view = render(
    <GlobalContext.Provider value={{ EventEmitter: { emit } } as any}>
      <ImageArtifactGallery artifacts={[artifact]} sessionId="100" />
    </GlobalContext.Provider>
  );
  fireEvent.click(screen.getByRole('button', { name: '查看图片：second.png' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '放大' }));
  expect(screen.getByText('125%')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '适应画布' }));
  expect(screen.getByText('100%')).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '引用' }));
  await waitFor(() =>
    expect(emit).toHaveBeenCalledWith('queryInput-insert-item', {
      type: 'COMMON_FILE',
      item: {
        name: 'second.png',
        path: artifact.path,
        isDir: false,
        size: undefined,
        id: artifact.path,
        collectionName: 'second.png',
        resourceId: 'agent-1',
        type: 'file',
      },
    })
  );
  expect(screen.queryByRole('button', { name: /编辑/ })).not.toBeInTheDocument();
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});
test('references use the same normalized file path as the session file panel', async () => {
  render(
    <GlobalContext.Provider value={{ EventEmitter: { emit } } as any}>
      <ImageArtifactGallery artifacts={[{ ...artifact, path: '/by' + artifact.path }]} sessionId="100" />
    </GlobalContext.Provider>
  );
  fireEvent.click(screen.getByRole('button', { name: '查看图片：second.png' }));
  fireEvent.click(await within(screen.getByRole('dialog')).findByRole('button', { name: '引用' }));
  expect(emit).toHaveBeenCalledWith(
    'queryInput-insert-item',
    expect.objectContaining({
      item: expect.objectContaining({ id: artifact.path, path: artifact.path }),
    })
  );
});

test('English icon actions and canvas labels use the shared locale and have accessible names', async () => {
  mockLocale = 'en-US';
  render(
    <GlobalContext.Provider value={{ EventEmitter: { emit } } as any}>
      <ImageArtifactGallery artifacts={[artifact]} sessionId="100" />
    </GlobalContext.Provider>
  );
  for (const name of ['View', 'Reference', 'Download']) {
    expect(screen.getByRole('button', { name, exact: true })).toHaveTextContent('');
  }
  fireEvent.click(screen.getByRole('button', { name: 'View', exact: true }));
  const dialog = await screen.findByRole('dialog', { name: 'Image canvas' });
  expect(within(dialog).getByRole('button', { name: 'Fit to canvas' })).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reference' }));
  expect(emit).toHaveBeenCalledWith('queryInput-insert-item', expect.objectContaining({ type: 'COMMON_FILE' }));
  expect(Object.keys(mockEnUS).sort()).toEqual(Object.keys(mockZhCN).sort());
  for (const key of Object.keys(mockZhCN) as Array<keyof typeof mockZhCN>) {
    expect(mockEnUS[key].match(/\{\w+\}/g) || []).toEqual(mockZhCN[key].match(/\{\w+\}/g) || []);
  }
});
