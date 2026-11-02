import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import FileBrowserPanel from './index';
import { getDefaultPath, listFiles, uploadFiles } from '@/service/fileBrowser';

let mockSessionId = 'chat-a';
const mockIntl = { formatMessage: ({ id }: { id: string }) => id };
jest.mock('@umijs/max', () => ({
  useIntl: () => mockIntl,
  useSelector: (selector: any) => selector({ user: { userInfo: { userCode: 'user-a', enterpriseId: 1 } } }),
}));
jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ EventEmitter: { emit: jest.fn() }, sessionId: mockSessionId }),
}));
jest.mock('@/service/fileBrowser', () => ({
  getDefaultPath: jest.fn(),
  listFiles: jest.fn(),
  uploadFiles: jest.fn(),
}));
jest.mock('@/components/InfiniteScrollTable', () => ({
  __esModule: true,
  default: ({ dataSource, columns }: any) => (
    <div>
      {dataSource.map((row: any) => (
        <div key={row.path}>{columns[0].render(row.name, row)}</div>
      ))}
    </div>
  ),
}));
jest.mock('@/components/ButtonsWithMore', () => () => null);
jest.mock('./MoveModal', () => () => null);
jest.mock('./RenameModal', () => () => null);

type Attempt = {
  resource: string;
  path: string;
  name: string;
  report: (event: any) => void;
  resolve: () => void;
  reject: (error: Error) => void;
  options: any;
};
let attempts: Attempt[];

beforeEach(() => {
  jest.clearAllMocks();
  mockSessionId = 'chat-a';
  attempts = [];
  (getDefaultPath as jest.Mock).mockImplementation((resource) => Promise.resolve(`/by/${resource}/`));
  (listFiles as jest.Mock).mockResolvedValue([]);
  (uploadFiles as jest.Mock).mockImplementation(
    (resource, path, files, report, _config, options) =>
      new Promise<void>((resolve, reject) => {
        attempts.push({ resource, path, name: files[0].name, report, resolve, reject, options });
      })
  );
});

function selectFiles(container: HTMLElement, names = ['a.txt', 'b.txt']) {
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: names.map((name) => new File(['12345678'], name)) },
  });
}

it('uploads a multi-selection once and keeps independent linear progress, failure and retry', async () => {
  const { container } = render(<FileBrowserPanel resourceId="employee-a" />);
  await waitFor(() => expect(listFiles).toHaveBeenCalledWith({ resourceId: 'employee-a', path: '/by/employee-a/' }));
  selectFiles(container);
  await waitFor(() => expect(attempts).toHaveLength(2));
  expect(attempts.map(({ name }) => name)).toEqual(['a.txt', 'b.txt']);
  expect((uploadFiles as jest.Mock).mock.calls.every((call) => call[2].length === 1)).toBe(true);
  act(() => {
    attempts[0].report({ loaded: 2, total: 8 });
    attempts[1].report({ loaded: 6, total: 8 });
  });
  const first = screen.getByRole('group', { name: 'a.txt' });
  const second = screen.getByRole('group', { name: 'b.txt' });
  expect(within(first).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  expect(within(second).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');
  await act(async () => {
    attempts[0].reject(new Error('a offline'));
    attempts[1].resolve();
  });
  expect(within(first).getByText('a offline')).toBeInTheDocument();
  expect(within(second).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  fireEvent.click(within(first).getByRole('button', { name: 'fileBrowser.upload.retryFile' }));
  await waitFor(() => expect(attempts).toHaveLength(3));
  expect(attempts[2]).toMatchObject({ resource: 'employee-a', path: '/by/employee-a/', name: 'a.txt' });
  await act(async () => attempts[2].resolve());
  expect(within(first).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
});

it('suppresses old employee progress, retries and completion refresh after a context switch', async () => {
  const { container, rerender } = render(<FileBrowserPanel resourceId="employee-a" />);
  await waitFor(() => expect(listFiles).toHaveBeenCalledWith({ resourceId: 'employee-a', path: '/by/employee-a/' }));
  selectFiles(container, ['old.txt']);
  await waitFor(() => expect(attempts).toHaveLength(1));
  const old = attempts[0];
  rerender(<FileBrowserPanel resourceId="employee-b" />);
  await waitFor(() => expect(listFiles).toHaveBeenCalledWith({ resourceId: 'employee-b', path: '/by/employee-b/' }));
  expect(screen.queryByRole('group', { name: 'old.txt' })).not.toBeInTheDocument();
  const calls = (listFiles as jest.Mock).mock.calls.length;
  act(() => old.report({ loaded: 8, total: 8 }));
  await act(async () => old.resolve());
  expect((listFiles as jest.Mock).mock.calls).toHaveLength(calls);
  expect(() => old.options.checkContext()).toThrow();
  selectFiles(container, ['new.txt']);
  await waitFor(() => expect(attempts).toHaveLength(2));
  expect(attempts[1]).toMatchObject({ resource: 'employee-b', path: '/by/employee-b/', name: 'new.txt' });
  await act(async () => attempts[1].resolve());
});

it('clears failed retries when the chat changes even for the same employee', async () => {
  const { container, rerender } = render(<FileBrowserPanel resourceId="employee-a" />);
  await waitFor(() => expect(listFiles).toHaveBeenCalled());
  selectFiles(container, ['failed.txt']);
  await waitFor(() => expect(attempts).toHaveLength(1));
  await act(async () => attempts[0].reject(new Error('offline')));
  expect(screen.getByRole('button', { name: 'fileBrowser.upload.retryFile' })).toBeInTheDocument();
  mockSessionId = 'chat-b';
  rerender(<FileBrowserPanel resourceId="employee-a" />);
  expect(screen.queryByRole('button', { name: 'fileBrowser.upload.retryFile' })).not.toBeInTheDocument();
  await waitFor(() => expect(listFiles).toHaveBeenCalledTimes(2));
});

it('keeps the original in-flight destination and removes retries on directory navigation', async () => {
  (listFiles as jest.Mock).mockImplementation(({ path }) =>
    Promise.resolve(
      path === '/by/employee-a/' ? [{ name: 'subfolder', path: '/by/employee-a/subfolder/', isDir: true }] : []
    )
  );
  const { container } = render(<FileBrowserPanel resourceId="employee-a" />);
  await screen.findByText('subfolder');
  selectFiles(container, ['old-directory.txt']);
  await waitFor(() => expect(attempts).toHaveLength(1));
  fireEvent.click(screen.getByText('subfolder'));
  await waitFor(() =>
    expect(listFiles).toHaveBeenCalledWith({ resourceId: 'employee-a', path: '/by/employee-a/subfolder/' })
  );
  expect(screen.queryByRole('group', { name: 'old-directory.txt' })).not.toBeInTheDocument();
  expect(attempts[0]).toMatchObject({ resource: 'employee-a', path: '/by/employee-a/' });
  expect(() => attempts[0].options.checkContext()).toThrow();
  await act(async () => attempts[0].reject(new Error('offline')));
  expect(screen.queryByRole('button', { name: 'fileBrowser.upload.retryFile' })).not.toBeInTheDocument();
  selectFiles(container, ['new-directory.txt']);
  await waitFor(() => expect(attempts).toHaveLength(2));
  expect(attempts[1]).toMatchObject({ resource: 'employee-a', path: '/by/employee-a/subfolder/' });
  await act(async () => attempts[1].resolve());
});

it('ignores a late default directory from the previous employee', async () => {
  let finishOld: (path: string) => void;
  (getDefaultPath as jest.Mock).mockImplementation((resource) => {
    if (resource === 'employee-a')
      return new Promise<string>((resolve) => {
        finishOld = resolve;
      });
    return Promise.resolve('/by/employee-b/');
  });
  const { container, rerender } = render(<FileBrowserPanel resourceId="employee-a" />);
  rerender(<FileBrowserPanel resourceId="employee-b" />);
  await waitFor(() => expect(listFiles).toHaveBeenCalledWith({ resourceId: 'employee-b', path: '/by/employee-b/' }));
  await act(async () => finishOld!('/by/employee-a/'));
  selectFiles(container, ['correct-context.txt']);
  await waitFor(() => expect(attempts).toHaveLength(1));
  expect(attempts[0]).toMatchObject({ resource: 'employee-b', path: '/by/employee-b/' });
  await act(async () => attempts[0].resolve());
});
