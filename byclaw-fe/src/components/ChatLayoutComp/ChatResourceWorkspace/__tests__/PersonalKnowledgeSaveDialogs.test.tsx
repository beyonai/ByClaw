import { act, fireEvent, render, screen } from '@testing-library/react';
import { getDcSystemConfig } from '@/pages/manager/service/session';
import KnowledgeTargetSelector from '@/components/KnowledgeTargetSelector';
import PersonalKnowledgeSaveDialogs from '../PersonalKnowledgeSaveDialogs';

jest.mock('@umijs/max', () => {
  const messages: Record<string, string> = {
    'chatResource.personalKnowledge.saveOnly': '仅保存',
    'chatResource.personalKnowledge.confirm': '仅保存并构建',
    'knowledgeDetail.processFrontMatter': '解析 YAML Front Matter',
  };
  const intl = { locale: 'zh-CN', formatMessage: ({ id }: { id: string }) => messages[id] || id };
  return { useIntl: () => intl };
});
jest.mock('@/pages/manager/service/session', () => ({ getDcSystemConfig: jest.fn() }));
jest.mock('@/components/AntdIcon', () => () => null);

const mockConfig = getDcSystemConfig as jest.Mock;
const kb = { resourceId: '20', resourceName: 'My knowledge' };
const createState = (overrides = {}): any => ({
  saveModalOpen: true,
  knowledgeKeyword: '',
  knowledgeBases: [kb],
  selectedKnowledgeBase: kb,
  knowledgeDirectoryPath: '/',
  knowledgeFolders: [],
  knowledgeFolderLoading: false,
  knowledgeFolderReady: true,
  savingToKnowledge: false,
  pendingBuildAfterSave: true,
  knowledgeUploadConfirmOpen: false,
  pendingKnowledgeUploads: [{ name: 'report.md' }],
  pendingKnowledgeDirectoryPath: '/chosen',
  pendingKnowledgeConflicts: [],
  saveResult: null,
  saveResultBuildRequested: true,
  setKnowledgeKeyword: jest.fn(),
  loadKnowledgeBases: jest.fn(),
  loadKnowledgeFolders: jest.fn(),
  loadKnowledgeFolderChildren: jest.fn().mockResolvedValue([]),
  handleSelectKnowledgeBase: jest.fn(),
  handleConfirmSaveToKnowledge: jest.fn(),
  handleCancelSaveToKnowledge: jest.fn(),
  handleConfirmKnowledgeUpload: jest.fn(),
  handleCancelKnowledgeUpload: jest.fn(),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.mockResolvedValue({ paramValue: 'openSource' });
});

test('shows both save actions after selecting a knowledge base and disables them until the directory is ready', async () => {
  const state = createState({ selectedKnowledgeBase: null });
  const { rerender } = render(<PersonalKnowledgeSaveDialogs state={state} />);
  await act(async () => {});
  expect(screen.queryByRole('button', { name: '仅保存' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /仅保存并构建/ })).not.toBeInTheDocument();
  rerender(
    <PersonalKnowledgeSaveDialogs state={{ ...state, selectedKnowledgeBase: kb, knowledgeFolderReady: false }} />
  );
  expect(screen.getByRole('button', { name: '仅保存' })).toBeDisabled();
  expect(screen.getByRole('button', { name: /仅保存并构建/ })).toBeDisabled();
  rerender(<PersonalKnowledgeSaveDialogs state={{ ...state, selectedKnowledgeBase: kb }} />);
  fireEvent.click(screen.getByRole('button', { name: '仅保存' }));
  expect(state.handleConfirmSaveToKnowledge).toHaveBeenLastCalledWith(false);
  fireEvent.click(screen.getByRole('button', { name: /仅保存并构建/ }));
  expect(state.handleConfirmSaveToKnowledge).toHaveBeenLastCalledWith(true);
  rerender(<PersonalKnowledgeSaveDialogs state={{ ...state, selectedKnowledgeBase: kb, savingToKnowledge: true }} />);
  expect(screen.getByRole('button', { name: '仅保存' })).toBeDisabled();
  expect(screen.getByRole('button', { name: /仅保存并构建/ })).toBeDisabled();
});

test('hides the entire YAML option in commercial editions and confirms without parsing', async () => {
  mockConfig.mockResolvedValue({ data: { paramValue: 'commercial' } });
  const state = createState({ saveModalOpen: false, knowledgeUploadConfirmOpen: true, pendingBuildAfterSave: false });
  render(<PersonalKnowledgeSaveDialogs state={state} />);
  await act(async () => {});
  expect(mockConfig).toHaveBeenCalledWith({ paramCode: 'BYAI_BRAND_VERSION' });
  expect(screen.queryByText('解析 YAML Front Matter')).not.toBeInTheDocument();
  expect(screen.queryByText('knowledgeDetail.processFrontMatterTip')).not.toBeInTheDocument();
  expect(screen.queryByText('knowledgeDetail.processFrontMatterDefaultTip')).not.toBeInTheDocument();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '仅保存' }));
  expect(state.handleConfirmKnowledgeUpload).toHaveBeenCalledWith(false);
});

test('preserves the optional YAML parsing switch in open-source editions', async () => {
  const state = createState({ saveModalOpen: false, knowledgeUploadConfirmOpen: true });
  render(<PersonalKnowledgeSaveDialogs state={state} />);
  expect(await screen.findByText('解析 YAML Front Matter')).toBeInTheDocument();
  expect(screen.getByRole('switch')).not.toBeChecked();
  fireEvent.click(screen.getByRole('switch'));
  fireEvent.click(screen.getByRole('button', { name: /仅保存并构建/ }));
  expect(state.handleConfirmKnowledgeUpload).toHaveBeenCalledWith(true);
});

test('retains the YAML option if brand configuration cannot be loaded', async () => {
  mockConfig.mockRejectedValue(new Error('offline'));
  render(
    <PersonalKnowledgeSaveDialogs state={createState({ saveModalOpen: false, knowledgeUploadConfirmOpen: true })} />
  );
  expect(await screen.findByText('解析 YAML Front Matter')).toBeInTheDocument();
});

test.each([false, true])('overwrite confirmation matches the selected build mode %s', async (buildAfterSave) => {
  const state = createState({
    saveModalOpen: false,
    knowledgeUploadConfirmOpen: true,
    pendingBuildAfterSave: buildAfterSave,
    pendingKnowledgeConflicts: ['/chosen/report.md'],
  });
  render(<PersonalKnowledgeSaveDialogs state={state} />);
  await act(async () => {});
  const key = buildAfterSave ? 'overwrite' : 'overwriteOnly';
  fireEvent.click(screen.getByRole('button', { name: `chatResource.personalKnowledge.${key}` }));
  expect(state.handleConfirmKnowledgeUpload).toHaveBeenCalledWith(false);
});

test('save-only results do not claim that document builds are running', async () => {
  render(
    <PersonalKnowledgeSaveDialogs
      state={createState({
        saveModalOpen: false,
        saveResultBuildRequested: false,
        saveResult: {
          uploadedFileCount: 1,
          createdFolderCount: 0,
          buildSubmittedCount: 0,
          failedItems: [],
          buildFailedItems: [],
          postProcessErrors: [],
        },
      })}
    />
  );
  await act(async () => {});
  expect(screen.getByText('chatResource.personalKnowledge.savedSummary')).toBeInTheDocument();
  expect(screen.getByText('chatResource.personalKnowledge.saveOnlyTip')).toBeInTheDocument();
  expect(screen.queryByText('chatResource.personalKnowledge.buildTip')).not.toBeInTheDocument();
});

test('the shared selector retains its default confirm action for other save flows', () => {
  const onOk = jest.fn();
  render(
    <KnowledgeTargetSelector
      open
      onOk={onOk}
      onCancel={jest.fn()}
      keyword=""
      onKeywordChange={jest.fn()}
      onSearch={jest.fn()}
      knowledgeBases={[kb]}
      selectedKnowledgeBase={kb}
      onSelectKnowledgeBase={jest.fn()}
      directoryPath="/"
      folders={[]}
      onFolderClick={jest.fn()}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));
  expect(onOk).toHaveBeenCalledTimes(1);
});
