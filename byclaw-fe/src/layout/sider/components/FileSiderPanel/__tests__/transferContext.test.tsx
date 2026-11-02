import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { listFiles, uploadFiles } from '@/service/fileBrowser';
import FileMiniList from '../FileMiniList';

const mockIntl = { formatMessage: ({ id }: { id: string }) => id };
const mockUser = { userCode: 'actor', userId: '1' };
const mockEmitter = { on: jest.fn(), off: jest.fn(), emit: jest.fn() };
let mockSessionId = '';
let mockModal: any;
const mockFile = new File(['zip-body'], 'skill.zip');
jest.mock('@umijs/max', () => ({ useIntl: () => mockIntl, useSelector: () => mockUser }));
jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ EventEmitter: mockEmitter, sessionId: mockSessionId }),
}));
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
jest.mock('../components/FileCategoryHeader', () => ({
  __esModule: true,
  default: ({ category, onUploadSelect }: any) => (
    <button
      onClick={(event) => {
        event.stopPropagation();
        onUploadSelect(category, [mockFile]);
      }}
    >
      choose-{category.key}
    </button>
  ),
}));
jest.mock('../components/FileTreeList', () => ({
  __esModule: true,
  default: ({ items }: any) => <div>{items.map((item: any) => item.name).join(',')}</div>,
}));
jest.mock('../components/SearchResultList', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/FileMiniListModals', () => ({
  __esModule: true,
  default: (props: any) => {
    mockModal = props;
    return (
      <div>
        {props.uploadConfirmOpen && <button onClick={() => props.onUploadConfirmOk(false)}>confirm-upload</button>}
        {props.uploadProgressRows.map(
          (row: any) =>
            row.status === 'failed' && (
              <button key={row.id} onClick={() => props.onRetryUploadFile(row.id)}>
                retry-{row.id}
              </button>
            )
        )}
      </div>
    );
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSessionId = '';
  mockModal = undefined;
  (listFiles as jest.Mock).mockResolvedValue([]);
});

async function chooseAndConfirm() {
  fireEvent.click(screen.getByText('choose-root'));
  await waitFor(() => expect(mockModal.uploadConfirmOpen).toBe(true));
  fireEvent.click(screen.getByText('confirm-upload'));
  await waitFor(() => expect(uploadFiles).toHaveBeenCalledTimes(1));
}

test('failed ZIP retries cannot be retained under another employee and an old retry callback cannot send there', async () => {
  (uploadFiles as jest.Mock).mockRejectedValue(new Error('offline'));
  const { rerender } = render(<FileMiniList resourceId="employee-a" />);
  await chooseAndConfirm();
  await waitFor(() => expect(mockModal.uploadProgressRows[0].status).toBe('failed'));
  const staleRetry = mockModal.onRetryUploadFile;
  const id = mockModal.uploadProgressRows[0].id;
  rerender(<FileMiniList resourceId="employee-b" />);
  expect(mockModal.uploadProgressRows).toHaveLength(0);
  expect(mockModal.uploadConfirmOpen).toBe(false);
  await act(async () => staleRetry(id));
  expect(uploadFiles).toHaveBeenCalledTimes(1);
  expect((uploadFiles as jest.Mock).mock.calls[0][0]).toBe('employee-a');
});

test('an old batch completion cannot fetch its employee list into a new chat context', async () => {
  let finish: (value: any) => void;
  (uploadFiles as jest.Mock).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { rerender } = render(<FileMiniList resourceId="employee-a" />);
  await chooseAndConfirm();
  mockSessionId = 'new-chat';
  rerender(<FileMiniList resourceId="employee-b" />);
  await waitFor(() =>
    expect((listFiles as jest.Mock).mock.calls.some(([request]) => request.resourceId === 'employee-b')).toBe(true)
  );
  const before = (listFiles as jest.Mock).mock.calls.filter(([request]) => request.resourceId === 'employee-a').length;
  await act(async () => finish!({}));
  const after = (listFiles as jest.Mock).mock.calls.filter(([request]) => request.resourceId === 'employee-a').length;
  expect(after).toBe(before);
  expect(mockModal.uploadProgressRows).toHaveLength(0);
});

test('a late selection lookup cannot reopen the old upload modal after switching employees', async () => {
  const { rerender } = render(<FileMiniList resourceId="employee-a" />);
  await waitFor(() => expect(listFiles).toHaveBeenCalled());
  let finish: (value: any) => void;
  (listFiles as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  fireEvent.click(screen.getByText('choose-root'));
  rerender(<FileMiniList resourceId="employee-b" />);
  await act(async () => finish!([]));
  expect(mockModal.uploadConfirmOpen).toBe(false);
});
