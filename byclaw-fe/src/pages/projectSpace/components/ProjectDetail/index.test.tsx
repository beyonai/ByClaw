import { act, fireEvent, render, screen } from '@testing-library/react';
import type { DefaultValueSchema } from '@/components/QueryInput/RichInput/types';
import { clearAutomationCreationDraft, getAutomationCreationDraft } from '@/pages/automation/drafts';
import ProjectDetail from '.';

const mockIntl = { formatMessage: ({ id }: { id: string }) => id };
let mockPromptRenders = 0;

jest.mock('@umijs/max', () => ({ useIntl: () => mockIntl, useSelector: () => ({ userId: 1 }) }));
jest.mock('@/service/devloop', () => ({ createScanSource: jest.fn(), updateScanSource: jest.fn() }));
jest.mock('@/pages/projectSpace/hooks/useProjectScopeId', () => ({ useProjectScopeId: () => ['1'] }));
jest.mock('@/pages/projectSpace/hooks/useProjectList', () => ({
  useProjectList: () => ({ projects: [{ projectId: '1', projectName: 'Project One' }], loading: false }),
}));
jest.mock('@/layout/sider/components/ProjectSpaceList/operation', () => ({ OperationTaskFormModal: () => null }));
jest.mock('../ProjectAccounts', () => () => null);
jest.mock('../ProjectMembers', () => () => null);
jest.mock('../ProjectRequirements', () => () => null);
jest.mock('../ProjectTasks', () => () => null);
jest.mock('../ProjectRepositoryManager', () => () => null);
jest.mock('../ProjectResources', () => (props: any) => (
  <>
    <button type="button" onClick={props.onOpenScheduleTaskCreate}>
      Create schedule
    </button>
    <button type="button" onClick={() => props.onResourceReference({ name: 'Project file' })}>
      Reference file
    </button>
  </>
));
jest.mock(
  '@/components/QueryInput',
  () => (props: { inputDraft?: DefaultValueSchema; onInputDraftChange: (draft: DefaultValueSchema) => void }) => {
    mockPromptRenders += 1;
    // 在回调注册循环回归时尽早失败，避免 React 无限更新淹没测试输出。
    if (mockPromptRenders > 30) throw new Error('Schedule prompt is rendering in a loop');
    return (
      <textarea
        aria-label="Prompt"
        defaultValue={props.inputDraft?.text}
        onChange={(event) => props.onInputDraftChange({ text: event.target.value, resourceList: [] })}
      />
    );
  }
);

beforeEach(() => {
  mockPromptRenders = 0;
  clearAutomationCreationDraft();
});

it('keeps the project schedule editor stable while editing and referencing the latest draft', () => {
  render(
    <ProjectDetail
      project={{ projectId: '1', projectName: 'Project One', projectType: 'normal', isShare: 'N', sharedFlag: false }}
      onBack={jest.fn()}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
  const prompt = screen.getByRole('textbox', { name: 'Prompt' }) as HTMLTextAreaElement;
  fireEvent.change(prompt, { target: { value: 'Check server status' } });
  act(() => {
    prompt.focus();
    prompt.setSelectionRange(6, 12);
  });
  fireEvent.change(screen.getByLabelText('automation.name'), { target: { value: 'Server report' } });
  expect(screen.getByRole('textbox', { name: 'Prompt' })).toBe(prompt);
  expect(prompt).toHaveFocus();
  expect([prompt.selectionStart, prompt.selectionEnd]).toEqual([6, 12]);
  expect(getAutomationCreationDraft()?.prompt.text).toBe('Check server status');

  fireEvent.click(screen.getByRole('button', { name: 'Reference file' }));
  expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveValue('Check server status #Project file');
  expect(getAutomationCreationDraft()?.prompt.resourceList).toEqual([{ name: 'Project file' }]);
  fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
  expect(screen.queryByRole('textbox', { name: 'Prompt' })).not.toBeInTheDocument();
});
