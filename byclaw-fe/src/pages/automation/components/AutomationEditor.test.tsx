import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { message } from 'antd';
import type { DefaultValueSchema } from '@/components/QueryInput/RichInput/types';
import { ResourceType } from '@/components/QueryInput/RichInput/utils/constants';
import { createScanSource } from '@/service/devloop';
import { clearAutomationCreationDraft, getAutomationCreationDraft } from '../drafts';
import AutomationEditor from './AutomationEditor';

let mockInputProps: {
  inputDraft: DefaultValueSchema;
  onInputDraftChange: (draft: DefaultValueSchema) => void;
};
let mockScopedProjectId = '1';

jest.mock('@/components/QueryInput', () => ({
  __esModule: true,
  default: (props: typeof mockInputProps) => {
    mockInputProps = props;
    return <div data-testid="automation-prompt">{props.inputDraft.text}</div>;
  },
}));
jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));
jest.mock('@/pages/projectSpace/hooks/useProjectScopeId', () => ({
  useProjectScopeId: () => [mockScopedProjectId],
}));
jest.mock('@/pages/projectSpace/hooks/useProjectList', () => ({
  useProjectList: () => ({
    projects: [
      { projectId: '1', projectName: 'Project One' },
      { projectId: '2', projectName: 'Project Two' },
    ],
    loading: false,
  }),
}));
jest.mock('@/service/devloop', () => ({ createScanSource: jest.fn(), updateScanSource: jest.fn() }));

const draft: DefaultValueSchema = {
  text: '{{DIGITAL_EMPLOYEE_agent-1}} Summarize {{DATA_SOURCE_17}}',
  resourceList: [
    {
      id: 'DIGITAL_EMPLOYEE_agent-1',
      resourceType: ResourceType.digitalEmployee,
      resourceId: 'agent-1',
      resourceName: 'Employee One',
    },
    { id: 'DATA_SOURCE_17', resourceType: ResourceType.dataSource, resourceId: '17', resourceName: 'Analytics' },
  ],
};

const props = { onCancel: jest.fn(), onSaved: jest.fn() };
const fillDraft = () => {
  fireEvent.change(screen.getByRole('textbox', { name: 'automation.name' }), { target: { value: 'Daily summary' } });
  act(() => mockInputProps.onInputDraftChange(draft));
};

describe('AutomationEditor creation draft', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearAutomationCreationDraft();
    clearAutomationCreationDraft('template-one');
    mockScopedProjectId = '1';
    jest.spyOn(message, 'success').mockImplementation(() => undefined as any);
    jest.spyOn(message, 'error').mockImplementation(() => undefined as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('restores the name, schedule, prompt, employees and references after leaving the page', () => {
    const view = render(<AutomationEditor {...props} />);
    fillDraft();
    fireEvent.click(screen.getByRole('radio', { name: 'automation.schedule.interval' }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3' } });
    view.unmount();
    render(<AutomationEditor {...props} />);
    expect(screen.getByRole('textbox', { name: 'automation.name' })).toHaveValue('Daily summary');
    // InputNumber 的一位小数格式应在草稿恢复后保持一致。
    expect(screen.getByRole('spinbutton')).toHaveValue('3.0');
    expect(mockInputProps.inputDraft).toEqual(draft);
    expect(getAutomationCreationDraft()?.values.projectId).toBe('1');
  });

  it('keeps user edits when the global project scope changes', () => {
    const view = render(<AutomationEditor {...props} />);
    fillDraft();
    mockScopedProjectId = '2';
    view.rerender(<AutomationEditor {...props} />);
    expect(mockInputProps.inputDraft).toEqual(draft);
    expect(screen.getByRole('textbox', { name: 'automation.name' })).toHaveValue('Daily summary');
    expect(getAutomationCreationDraft()?.values.projectId).toBe('1');
  });

  it('keeps existing task edits and template creation separate from the blank creation draft', () => {
    const view = render(<AutomationEditor {...props} />);
    fillDraft();
    view.rerender(
      <AutomationEditor
        {...props}
        source={{ sourceId: 5, sourceName: 'Existing', config: JSON.stringify({ chatContent: 'Saved prompt' }) }}
      />
    );
    expect(mockInputProps.inputDraft.text).toBe('Saved prompt');
    act(() => mockInputProps.onInputDraftChange({ text: 'Edited existing prompt', resourceList: [] }));
    view.rerender(
      <AutomationEditor
        {...props}
        template={{ key: 'template-one', name: 'Template', prompt: 'Template prompt', schedule: { mode: 'periodic' } }}
      />
    );
    expect(mockInputProps.inputDraft.text).toBe('Template prompt');
    act(() => mockInputProps.onInputDraftChange({ text: 'Edited template prompt', resourceList: [] }));
    view.rerender(<AutomationEditor {...props} />);
    expect(mockInputProps.inputDraft).toEqual(draft);
    expect(getAutomationCreationDraft('template-one')?.prompt.text).toBe('Edited template prompt');
  });

  it('remembers clearing the prompt instead of resurrecting older content', () => {
    const view = render(<AutomationEditor {...props} />);
    fillDraft();
    act(() => mockInputProps.onInputDraftChange({ text: '', resourceList: [] }));
    view.unmount();
    render(<AutomationEditor {...props} />);
    expect(mockInputProps.inputDraft).toEqual({ text: '', resourceList: [] });
  });

  it('discards the creation draft only when explicitly cancelled', () => {
    const view = render(<AutomationEditor {...props} />);
    fillDraft();
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(getAutomationCreationDraft()).toBeUndefined();
    view.unmount();
    render(<AutomationEditor {...props} />);
    expect(mockInputProps.inputDraft.text).toBe('');
  });

  it('clears the draft after successful creation and sends its referenced resources', async () => {
    (createScanSource as jest.Mock).mockResolvedValue({});
    render(<AutomationEditor {...props} />);
    fillDraft();
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledTimes(1));
    expect(JSON.parse((createScanSource as jest.Mock).mock.calls[0][0].config)).toMatchObject({
      chatContent: draft.text,
      resourceList: draft.resourceList,
    });
    expect(getAutomationCreationDraft()).toBeUndefined();
  });

  it('retains the complete draft if saving fails', async () => {
    (createScanSource as jest.Mock).mockRejectedValue(new Error('Save failed'));
    const view = render(<AutomationEditor {...props} />);
    fillDraft();
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(message.error).toHaveBeenCalledWith('Save failed'));
    view.unmount();
    render(<AutomationEditor {...props} />);
    expect(mockInputProps.inputDraft).toEqual(draft);
    expect(screen.getByRole('textbox', { name: 'automation.name' })).toHaveValue('Daily summary');
    expect(props.onSaved).not.toHaveBeenCalled();
  });
});
