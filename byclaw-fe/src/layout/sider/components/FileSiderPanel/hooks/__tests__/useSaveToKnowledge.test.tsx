import { act, renderHook, waitFor } from '@testing-library/react';
import { listResourceUseAuth, queryDigEmployeeManageKnowledgeResourceAuth } from '@/pages/manager/service/resources';
import { buildDataset, checkUploadFileConflicts, queryDirAndFileByLevel } from '@/service/knowledgeCenter';
import { downloadFile, listFiles, saveToPersonalKnowledge } from '@/service/fileBrowser';
import useSaveToKnowledge from '../useSaveToKnowledge';

const mockIntl = { locale: 'zh-CN', formatMessage: ({ id }: { id: string }) => id };
jest.mock('@umijs/max', () => ({ useIntl: () => mockIntl }));
jest.mock('@/pages/manager/service/resources', () => ({
  listResourceUseAuth: jest.fn(),
  queryDigEmployeeManageKnowledgeResourceAuth: jest.fn(),
}));
jest.mock('@/service/knowledgeCenter', () => ({
  buildDataset: jest.fn(),
  checkUploadFileConflicts: jest.fn(),
  queryDirAndFileByLevel: jest.fn(),
  createFolder: jest.fn(),
  uploadFiles: jest.fn(),
}));
jest.mock('@/service/fileBrowser', () => ({
  downloadFile: jest.fn(),
  listFiles: jest.fn(),
  saveToPersonalKnowledge: jest.fn(),
}));
jest.mock('@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/constants', () => ({
  getMimeType: () => 'text/plain',
  isPreviewable: () => true,
}));

const kb = { resourceId: '20', resourceName: 'My knowledge', ownerType: 'personal', hasManagePermission: true } as any;
const file = { name: 'report.md', path: '/by/.sessions/10/report.md', isDir: false };
const saved = {
  targetResourceId: '20',
  targetDirectoryPath: '/chosen',
  createdFolderCount: 0,
  uploadedFileCount: 1,
  buildSubmittedCount: 1,
  failedItems: [],
  buildFailedItems: [],
  postProcessErrors: [],
};
const mocked = (fn: unknown) => fn as jest.Mock;
const hook = (personalOnly = true) =>
  renderHook(() =>
    useSaveToKnowledge({
      resourceId: '10',
      personalOnly,
      clearClickTimer: () => {},
    })
  );

beforeEach(() => {
  jest.clearAllMocks();
  mocked(listResourceUseAuth).mockResolvedValue({ rows: [kb], total: 1 });
  mocked(queryDirAndFileByLevel).mockResolvedValue([]);
  mocked(checkUploadFileConflicts).mockResolvedValue({ overwritePaths: [] });
  mocked(saveToPersonalKnowledge).mockResolvedValue(saved);
  mocked(buildDataset).mockResolvedValue(undefined);
});

test('loads every page of manageable personal knowledge including the default, independent of employee bindings', async () => {
  const defaultKb = { ...kb, resourceId: '21', ownerType: 'personal_default' };
  mocked(listResourceUseAuth)
    .mockResolvedValueOnce({
      rows: [kb, { ...kb, ownerType: 'enterprise' }, { ...kb, hasManagePermission: false }],
      totalPages: 2,
    })
    .mockResolvedValueOnce({ rows: [defaultKb], totalPages: 2 });
  const { result } = hook();
  await act(async () => result.current.loadKnowledgeBases('report'));
  expect(result.current.knowledgeBases).toEqual([kb, defaultKb]);
  expect(listResourceUseAuth).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      ownerType: 'personal',
      permission: 'MANAGEABLE_BY_ME',
      pageNum: 2,
      keyword: 'report',
      excludeDeleted: true,
    })
  );
  expect(queryDigEmployeeManageKnowledgeResourceAuth).not.toHaveBeenCalled();
});

test.each([false, true])('preserves buildAfterSave=%s through overwrite confirmation', async (buildAfterSave) => {
  mocked(checkUploadFileConflicts).mockResolvedValue({ overwritePaths: ['/chosen/report.md'] });
  const { result } = hook();
  act(() => result.current.openSaveToKnowledge(file));
  act(() => result.current.handleSelectKnowledgeBase(kb));
  await waitFor(() => expect(result.current.knowledgeFolderLoading).toBe(false));
  await act(async () => result.current.loadKnowledgeFolders(kb, '/chosen'));
  await act(async () => result.current.handleConfirmSaveToKnowledge(buildAfterSave));
  expect(result.current.pendingKnowledgeConflicts).toEqual(['/chosen/report.md']);
  expect(saveToPersonalKnowledge).not.toHaveBeenCalled();
  await act(async () => result.current.handleConfirmKnowledgeUpload(false));
  expect(saveToPersonalKnowledge).toHaveBeenCalledWith(
    expect.objectContaining({
      resourceId: '10',
      sourcePath: file.path,
      targetResourceId: '20',
      targetDirectoryPath: '/chosen',
      overwrite: true,
      buildAfterSave,
    })
  );
  expect(downloadFile).not.toHaveBeenCalled();
  expect(result.current.saveResult).toEqual(saved);
  expect(result.current.saveResultBuildRequested).toBe(buildAfterSave);
});

test.each([false, true])(
  'preserves folder paths and buildAfterSave=%s including empty folders',
  async (buildAfterSave) => {
    const folder = { name: 'reports', path: '/session/reports/', isDir: true };
    mocked(listFiles).mockImplementation(({ path }) =>
      Promise.resolve(
        path === folder.path
          ? [
              { ...file, path: '/session/reports/report.md' },
              { name: 'empty', path: '/session/reports/empty/', isDir: true },
            ]
          : []
      )
    );
    const { result } = hook();
    act(() => result.current.openSaveToKnowledge(folder));
    act(() => result.current.handleSelectKnowledgeBase(kb));
    await waitFor(() => expect(result.current.knowledgeFolderLoading).toBe(false));
    await act(async () => result.current.handleConfirmSaveToKnowledge(buildAfterSave));
    expect(checkUploadFileConflicts).toHaveBeenCalledWith({
      resourceId: '20',
      directoryPath: '/reports/',
      fileNames: ['report.md'],
    });
    await act(async () => result.current.handleConfirmKnowledgeUpload(false));
    expect(saveToPersonalKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({ sourceDir: true, sourcePath: folder.path, buildAfterSave })
    );
  }
);

test('retries only failed build submissions without importing files again', async () => {
  const { result } = hook();
  act(() =>
    result.current.setSaveResult({
      ...saved,
      buildSubmittedCount: 0,
      buildFailedItems: [{ filePath: '/chosen/report.md', error: 'offline' }],
    })
  );
  await act(async () => result.current.retryFailedBuilds());
  expect(buildDataset).toHaveBeenCalledWith({ resourceId: '20', directoryPath: '/chosen/report.md' });
  expect(saveToPersonalKnowledge).not.toHaveBeenCalled();
  expect(result.current.saveResult?.buildFailedItems).toEqual([]);
  expect(result.current.saveResult?.buildSubmittedCount).toBe(1);
});

test('retains the employee-scoped query for existing generic save dialogs', async () => {
  mocked(queryDigEmployeeManageKnowledgeResourceAuth).mockResolvedValue({ rows: [kb] });
  const { result } = hook(false);
  await act(async () => result.current.loadKnowledgeBases(''));
  expect(queryDigEmployeeManageKnowledgeResourceAuth).toHaveBeenCalledWith(
    expect.objectContaining({ resourceId: '10' })
  );
  expect(listResourceUseAuth).not.toHaveBeenCalled();
});

test('does not save to the previous directory when loading a newly selected directory fails', async () => {
  const { result } = hook();
  act(() => result.current.openSaveToKnowledge(file));
  act(() => result.current.handleSelectKnowledgeBase(kb));
  await waitFor(() => expect(result.current.knowledgeFolderReady).toBe(true));
  mocked(queryDirAndFileByLevel).mockRejectedValueOnce(new Error('offline'));
  await act(async () => result.current.loadKnowledgeFolders(kb, '/unavailable'));
  expect(result.current.knowledgeFolderReady).toBe(false);
  await act(async () => result.current.handleConfirmSaveToKnowledge(false));
  expect(checkUploadFileConflicts).not.toHaveBeenCalled();
  expect(result.current.knowledgeUploadConfirmOpen).toBe(false);
});

test('keeps save-only mode after a failed upload and prevents duplicate submissions', async () => {
  const { result } = hook();
  act(() => result.current.openSaveToKnowledge(file));
  act(() => result.current.handleSelectKnowledgeBase(kb));
  await waitFor(() => expect(result.current.knowledgeFolderReady).toBe(true));
  await act(async () => {
    await Promise.all([
      result.current.handleConfirmSaveToKnowledge(false),
      result.current.handleConfirmSaveToKnowledge(true),
    ]);
  });
  expect(result.current.pendingBuildAfterSave).toBe(false);
  expect(checkUploadFileConflicts).toHaveBeenCalledTimes(1);
  mocked(saveToPersonalKnowledge).mockRejectedValueOnce(new Error('offline'));
  await act(async () => result.current.handleConfirmKnowledgeUpload(false));
  expect(result.current.knowledgeUploadConfirmOpen).toBe(true);
  await act(async () => result.current.handleConfirmKnowledgeUpload(false));
  expect(saveToPersonalKnowledge).toHaveBeenLastCalledWith(expect.objectContaining({ buildAfterSave: false }));
  expect(result.current.knowledgeUploadConfirmOpen).toBe(false);
});
