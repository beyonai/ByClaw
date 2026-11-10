import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { message } from 'antd';
import { ensureFolder, listFiles } from '@/service/fileBrowser';
import FileMiniList from '../FileMiniList';

const mockIntl = { formatMessage: ({ id }: { id: string }) => id };
const mockUser = { userCode: 'actor', userId: '1' };
const mockEmitter = { on: jest.fn(), off: jest.fn(), emit: jest.fn() };
jest.mock('@umijs/max', () => ({ useIntl: () => mockIntl, useSelector: () => mockUser }));
jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ EventEmitter: mockEmitter, sessionId: 'chat-a' }),
}));
jest.mock('antd', () => {
  const actual = jest.requireActual('antd');
  return { ...actual, message: { ...actual.message, error: jest.fn() } };
});
jest.mock('@/utils/auth', () => ({ isAdminVip: () => true }));
jest.mock('@/components/QueryInput/withDrag', () => ({ DragType: {} }));
jest.mock('@/service/fileBrowser', () => ({
  listFiles: jest.fn(),
  uploadFiles: jest.fn(),
  ensureFolder: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/pages/manager/service/resources', () => ({ queryDigEmployeeManageKnowledgeResourceAuth: jest.fn() }));
jest.mock('@/service/knowledgeCenter', () => ({ checkUploadFileConflicts: jest.fn(), uploadFiles: jest.fn() }));
jest.mock('../hooks/useCopyToFileBrowser', () => ({ __esModule: true, default: () => ({}) }));
jest.mock('../hooks/useSaveToKnowledge', () => ({ __esModule: true, default: () => ({}) }));
jest.mock('../hooks/useFilePreviewActions', () => ({ __esModule: true, default: () => ({}) }));
jest.mock('../components/FileMiniListModals', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/SearchResultList', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/FileCategoryHeader', () => ({
  __esModule: true,
  default: ({ category, onRefresh, onOpenPath }: any) => (
    <span>
      {`category-${category.key}`}
      <button
        onClick={(event) => {
          event.stopPropagation();
          onRefresh(category);
        }}
      >
        refresh-{category.key}
      </button>
      <button
        onClick={(event) => {
          event.stopPropagation();
          onOpenPath(category, '/.sessions/chat-a/reports/deep/');
        }}
      >
        open-deep-{category.key}
      </button>
    </span>
  ),
}));

const rootPath = '/.sessions/chat-a/';
const childPath = `${rootPath}reports/`;
let childVersion = 'old';

beforeEach(() => {
  jest.clearAllMocks();
  childVersion = 'old';
  jest.mocked(listFiles).mockImplementation(async ({ path }) => {
    if (path === rootPath) return [{ name: 'reports', path: childPath, isDir: true }];
    if (path === childPath)
      return [{ name: `${childVersion}.txt`, path: `${childPath}${childVersion}.txt`, isDir: false }];
    return [{ name: 'target.txt', path: `${path}target.txt`, isDir: false }];
  });
});

async function expandReports() {
  const name = await screen.findByText('reports');
  const switcher = name.closest('.ant-tree-treenode')!.querySelector('.ant-tree-switcher')!;
  fireEvent.click(switcher);
}

test('opening a nested directory lists that directory once without creating it or enumerating parents', async () => {
  render(<FileMiniList resourceId="employee-a" />);
  await screen.findByText('reports');
  jest.mocked(listFiles).mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'open-deep-session' }));
  await screen.findByText('target.txt');
  expect(listFiles).toHaveBeenCalledTimes(1);
  expect(listFiles).toHaveBeenCalledWith({
    resourceId: 'employee-a',
    path: '/.sessions/chat-a/reports/deep/',
    sort: 'DIRECTORY_FIRST_NAME_ASC',
  });
  expect(ensureFolder).not.toHaveBeenCalled();
});

test.each(['manual', 'automatic'])(
  '%s refresh fetches one directory and reloads children only on explicit expansion',
  async (kind) => {
    render(<FileMiniList resourceId="employee-a" />);
    await expandReports();
    await screen.findByText('old.txt');
    jest.mocked(listFiles).mockClear();
    childVersion = 'new';
    if (kind === 'manual') {
      fireEvent.click(screen.getByRole('button', { name: 'refresh-session' }));
    } else {
      const listeners = mockEmitter.on.mock.calls.filter(([name]) => name === 'chat-answer-completed');
      act(() => listeners[listeners.length - 1][1]({ sessionId: 'chat-a' }));
    }
    await waitFor(() => expect(listFiles).toHaveBeenCalled(), { timeout: 2000 });
    await waitFor(() => expect(screen.queryByText('old.txt')).not.toBeInTheDocument());
    expect(jest.mocked(listFiles).mock.calls.map(([request]) => request.path)).toEqual([rootPath]);
    expect(ensureFolder).not.toHaveBeenCalled();
    expect(screen.queryByText('new.txt')).not.toBeInTheDocument();
    await expandReports();
    await screen.findByText('new.txt');
    expect(listFiles).toHaveBeenCalledTimes(2);
    expect(jest.mocked(listFiles).mock.calls[1][0].path).toBe(childPath);
  }
);

test('a failed directory read reports the actual failure without creating a missing-directory substitute', async () => {
  jest.mocked(listFiles).mockRejectedValue(new Error('Forbidden'));
  render(<FileMiniList resourceId="employee-a" />);
  await waitFor(() => expect(message.error).toHaveBeenCalledWith('Forbidden'));
  expect(listFiles).toHaveBeenCalledTimes(1);
  expect(ensureFolder).not.toHaveBeenCalled();
});

test('a child read finishing after refresh cannot refill the invalidated subtree with stale data', async () => {
  let finishChild: (value: any) => void;
  let childReads = 0;
  jest.mocked(listFiles).mockImplementation(async ({ path }) => {
    if (path === rootPath) return [{ name: 'reports', path: childPath, isDir: true }];
    childReads += 1;
    if (childReads === 1) return new Promise((resolve) => (finishChild = resolve));
    return [{ name: 'fresh.txt', path: `${childPath}fresh.txt`, isDir: false }];
  });
  render(<FileMiniList resourceId="employee-a" />);
  await expandReports();
  await waitFor(() => expect(childReads).toBe(1));
  fireEvent.click(screen.getByRole('button', { name: 'refresh-session' }));
  await waitFor(() => expect(listFiles).toHaveBeenCalledTimes(3));
  await act(async () => finishChild!([{ name: 'stale.txt', path: `${childPath}stale.txt`, isDir: false }]));
  await expandReports();
  await screen.findByText('fresh.txt');
  expect(screen.queryByText('stale.txt')).not.toBeInTheDocument();
  expect(childReads).toBe(2);
});
