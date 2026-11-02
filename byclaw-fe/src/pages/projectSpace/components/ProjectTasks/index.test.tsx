import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { listOperationTasks, listTasks } from '@/service/devloop';
import ProjectTasks from '.';

const intl = { formatMessage: ({ id }: any) => id };
const mockEvents = { on: jest.fn(), off: jest.fn() };
jest.mock('@umijs/max', () => ({ useIntl: () => intl, useSelector: () => ({ userId: 1 }) }));
jest.mock('@/hooks/useGlobal', () => ({ __esModule: true, default: () => ({ EventEmitter: mockEvents }) }));
jest.mock('@/service/devloop', () => ({
  listTasks: jest.fn(),
  listOperationTasks: jest.fn(),
  listProjectMembers: jest.fn(),
}));
jest.mock('@/components/TaskTemplateModal', () => ({ __esModule: true, default: () => null }));
jest.mock('@/layout/sider/components/ProjectSpaceList/TaskDetailDrawer', () => ({
  __esModule: true,
  default: () => null,
}));

const project = {
  projectId: '-1',
  projectName: 'Default',
  projectType: 'default',
  isShare: 'N',
  sharedFlag: false,
} as const;
const result = (title: string) => ({ list: [{ taskId: title, taskName: title, title, sessionId: title }], total: 1 });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(listTasks).mockResolvedValue({ list: [], total: 0 } as any);
  jest.mocked(listOperationTasks).mockResolvedValue({ list: [], total: 0 } as any);
});

it('searches default project conversations while typing, on submit, and on clear', async () => {
  render(<ProjectTasks project={project} />);
  await waitFor(() => expect(listTasks).toHaveBeenCalled());
  const input = screen.getByPlaceholderText('projectSpace.tasks.keywordPlaceholder');
  expect(input).not.toHaveAttribute('readonly');
  fireEvent.change(input, { target: { value: '  hello  ' } });
  await waitFor(() =>
    expect(listTasks).toHaveBeenLastCalledWith(expect.objectContaining({ pageNum: 1, taskName: 'hello' }))
  );
  const count = jest.mocked(listTasks).mock.calls.length;
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 });
  await waitFor(() => expect(jest.mocked(listTasks).mock.calls.length).toBeGreaterThan(count));
  fireEvent.click(screen.getByLabelText('close-circle'));
  await waitFor(() =>
    expect(listTasks).toHaveBeenLastCalledWith(expect.objectContaining({ pageNum: 1, taskName: undefined }))
  );
});

it.each(['normal', 'develop'])('searches %s project tasks from the first page', async (projectType) => {
  render(<ProjectTasks project={{ ...project, projectId: '8', projectType } as any} />);
  fireEvent.change(screen.getByPlaceholderText('projectSpace.tasks.keywordPlaceholder'), {
    target: { value: 'task title' },
  });
  await waitFor(() =>
    expect(listTasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: 8, pageNum: 1, taskName: 'task title' })
    )
  );
  expect(listOperationTasks).not.toHaveBeenCalled();
});

it('uses the operation keyword parameter when searching an operation project', async () => {
  render(<ProjectTasks project={{ ...project, projectId: '7', projectType: 'operation' }} />);
  const input = screen.getByPlaceholderText('projectSpace.tasks.keywordPlaceholder');
  fireEvent.change(input, { target: { value: 'report' } });
  fireEvent.click(screen.getByRole('button', { name: 'search' }));
  await waitFor(() =>
    expect(listOperationTasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: 7, pageNum: 1, keyword: 'report' })
    )
  );
  expect(listTasks).not.toHaveBeenCalled();
});

it('does not let an older request replace a newer search result', async () => {
  let finishOld!: (value: any) => void;
  jest.mocked(listTasks).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      })
  );
  jest.mocked(listTasks).mockResolvedValue(result('Current search result') as any);
  render(<ProjectTasks project={project} />);
  await waitFor(() => expect(listTasks).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByPlaceholderText('projectSpace.tasks.keywordPlaceholder'), {
    target: { value: 'Current' },
  });
  await screen.findByText('Current search result');
  await act(async () => finishOld(result('Outdated search result')));
  expect(screen.queryByText('Outdated search result')).not.toBeInTheDocument();
  expect(screen.getByText('Current search result')).toBeInTheDocument();
});
