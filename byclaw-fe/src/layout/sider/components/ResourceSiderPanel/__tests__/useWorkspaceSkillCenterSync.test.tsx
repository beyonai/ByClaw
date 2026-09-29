import { act, renderHook, waitFor } from '@testing-library/react';
import { Modal, message } from 'antd';
import { queryWorkspaceSkillCenterStatus, syncWorkspaceSkillToCenter } from '@/pages/manager/service/resources';
import { useWorkspaceSkillCenterSync } from '../useWorkspaceSkillCenterSync';

jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: any) => id }) }));
jest.mock('antd', () => ({
  Modal: { confirm: jest.fn() },
  message: { success: jest.fn(), warning: jest.fn(), error: jest.fn() },
}));
jest.mock('@/pages/manager/service/resources', () => ({
  queryWorkspaceSkillCenterStatus: jest.fn(),
  syncWorkspaceSkillToCenter: jest.fn(),
}));

const skill = {
  resourceId: 'WORKSPACE_SKILL:/skills/demo',
  resourceName: 'demo',
  resourceBizType: 'SKILL',
  resourceBacked: false,
  skillPath: '/skills/demo',
};
const rows = [skill];
const query = queryWorkspaceSkillCenterStatus as jest.Mock;
const sync = syncWorkspaceSkillToCenter as jest.Mock;
const status = (action = 'INSTALL') => ({ action, ownerType: 'personal', revision: 'revision-1' });
const setup = (enabled = true) => {
  const onChanged = jest.fn();
  return {
    ...renderHook(({ employeeId }) => useWorkspaceSkillCenterSync({ employeeId, enabled, rows, onChanged }), {
      initialProps: { employeeId: 'employee-1' },
    }),
    onChanged,
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  query.mockReset().mockResolvedValue(status());
  sync.mockReset().mockResolvedValue({ resourceId: 'center-1', action: 'INSTALL', sourceDeleted: true });
});

it.each(['INSTALL', 'UPDATE'])(
  'checks only on opening the menu and shows %s from server comparison',
  async (action) => {
    query.mockResolvedValue({ code: 0, data: status(action) });
    const { result } = setup();
    expect(query).not.toHaveBeenCalled();
    expect(result.current.menuItem(skill)?.disabled).toBe(true);
    await act(async () => result.current.onOpen(skill));

    expect(query).toHaveBeenCalledWith({ resourceId: 'employee-1', skillPath: '/skills/demo' });
    expect(result.current.menuItem(skill)?.label).toBe(`resource.workspaceCenter.${action.toLowerCase()}`);
  }
);

it('hides both actions for identical markdown', async () => {
  query.mockResolvedValue(status('NONE'));
  const { result } = setup();
  await act(async () => result.current.onOpen(skill));
  expect(result.current.menuItem(skill)).toBeUndefined();
  act(() => result.current.onClick(skill));
  expect(Modal.confirm).not.toHaveBeenCalled();
  expect(sync).not.toHaveBeenCalled();
});

it('does not offer directory sync for resource-backed skills or users without employee management permission', async () => {
  const { result } = setup(false);
  await act(async () => result.current.onOpen(skill));
  expect(result.current.menuItem(skill)).toBeUndefined();
  expect(query).not.toHaveBeenCalled();
  const { result: enabled } = setup();
  const bound = { ...skill, resourceId: '123', resourceBacked: true };
  await act(async () => enabled.current.onOpen(bound));
  expect(enabled.current.menuItem(bound)).toBeUndefined();
  expect(query).not.toHaveBeenCalled();
});

it('confirms once and submits the comparison revision for the current employee', async () => {
  const { result, onChanged } = setup();
  await act(async () => result.current.onOpen(skill));
  act(() => {
    result.current.onClick(skill);
    result.current.onClick(skill);
  });
  expect(Modal.confirm).toHaveBeenCalledTimes(1);
  expect(sync).not.toHaveBeenCalled();
  await act(async () => (Modal.confirm as jest.Mock).mock.calls[0][0].onOk());
  expect(sync).toHaveBeenCalledWith({ resourceId: 'employee-1', skillPath: '/skills/demo', revision: 'revision-1' });
  expect(onChanged).toHaveBeenCalledWith(skill, true);
  expect(message.success).toHaveBeenCalled();
});

it('keeps the directory visible when the server reports a cleanup failure after saving', async () => {
  sync.mockResolvedValue({ code: 0, data: { resourceId: 'center-1', action: 'UPDATE', sourceDeleted: false } });
  const { result, onChanged } = setup();
  await act(async () => result.current.onOpen(skill));
  act(() => result.current.onClick(skill));
  await act(async () => (Modal.confirm as jest.Mock).mock.calls[0][0].onOk());
  expect(onChanged).toHaveBeenCalledWith(skill, false);
  expect(message.warning).toHaveBeenCalledWith('resource.workspaceCenter.cleanupFailed');
  expect(message.success).not.toHaveBeenCalled();
});

it('still refreshes the current employee when more rows load during installation', async () => {
  let resolve!: (value: any) => void;
  sync.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const onChanged = jest.fn();
  const { result, rerender } = renderHook(
    ({ items }) => useWorkspaceSkillCenterSync({ employeeId: 'employee-1', enabled: true, rows: items, onChanged }),
    { initialProps: { items: rows } }
  );
  await act(async () => result.current.onOpen(skill));
  act(() => result.current.onClick(skill));
  let submitted!: Promise<void>;
  act(() => {
    submitted = (Modal.confirm as jest.Mock).mock.calls[0][0].onOk();
  });
  rerender({ items: [...rows, { ...skill, skillPath: '/skills/second' }] });
  await act(async () => {
    resolve({ resourceId: 'center-1', action: 'INSTALL', sourceDeleted: true });
    await submitted;
  });
  expect(onChanged).toHaveBeenCalledWith(skill, true);
});

it('does not remove rows after business failure and requires a new comparison before retrying', async () => {
  sync.mockResolvedValue({ code: -1, msg: 'changed' });
  const { result, onChanged } = setup();
  await act(async () => result.current.onOpen(skill));
  act(() => result.current.onClick(skill));
  await act(async () => (Modal.confirm as jest.Mock).mock.calls[0][0].onOk());
  expect(onChanged).not.toHaveBeenCalled();
  expect(message.error).toHaveBeenCalledWith('changed');
  expect(result.current.menuItem(skill)?.label).toBe('resource.workspaceCenter.retry');
  await act(async () => result.current.onClick(skill));
  expect(query).toHaveBeenCalledTimes(2);
});

it('offers retry when comparison fails without guessing an installation action', async () => {
  query.mockRejectedValueOnce(new Error('offline'));
  const { result } = setup();
  await act(async () => result.current.onOpen(skill));
  expect(result.current.menuItem(skill)?.label).toBe('resource.workspaceCenter.retry');
  expect(sync).not.toHaveBeenCalled();
  await act(async () => result.current.onClick(skill));
  expect(result.current.menuItem(skill)?.label).toBe('resource.workspaceCenter.install');
});

it('discards comparison responses and confirmations from a previous employee', async () => {
  let resolve!: (value: any) => void;
  query.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const { result, rerender } = setup();
  act(() => result.current.onOpen(skill));
  rerender({ employeeId: 'employee-2' });
  await act(async () => resolve(status('UPDATE')));
  expect(result.current.menuItem(skill)?.disabled).toBe(true);
  await act(async () => result.current.onOpen(skill));
  await waitFor(() => expect(result.current.menuItem(skill)?.label).toBe('resource.workspaceCenter.install'));
  act(() => result.current.onClick(skill));
  rerender({ employeeId: 'employee-3' });
  await act(async () => (Modal.confirm as jest.Mock).mock.calls[0][0].onOk());
  expect(sync).not.toHaveBeenCalled();
});
