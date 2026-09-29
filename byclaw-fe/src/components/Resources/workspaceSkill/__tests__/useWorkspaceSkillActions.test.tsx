import React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { message } from 'antd';
import { queryResourceMembers, queryWorkspaceSkillDetail } from '@/pages/manager/service/resources';
import {
  DetailPanelContent,
  useDetailPanelLifecycle,
  useDetailPanelState,
} from '@/layout/pcLayout/useDetailPanelState';
import { useWorkspaceSkillActions } from '../useWorkspaceSkillActions';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: any) => id }),
  useSelector: () => ({ userInfo: { userCode: 'user-1', userName: 'Current user' } }),
}));
jest.mock('antd', () => ({ Modal: {}, message: { error: jest.fn() } }));
jest.mock('@/pages/manager/service/resources', () => ({
  queryWorkspaceSkillDetail: jest.fn(),
  queryResourceMembers: jest.fn(),
}));
jest.mock('@/components/Resources/components/ResourceDetail', () => ({
  __esModule: true,
  default: ({ loading, item, onCancel }: any) => (
    <div data-testid="detail">
      <button onClick={onCancel}>close detail</button>
      <span>{loading ? 'loading' : item?.resourceName || 'unavailable'}</span>
    </div>
  ),
}));

const skill = { skillPath: '/skills/first', resourceName: 'First', personalWorkspace: true };
const query = jest.mocked(queryWorkspaceSkillDetail);
const response = (skillName: string) => ({
  code: 0,
  msg: '',
  success: true,
  data: { skillName, skillPath: '/skills/example', skillDocObjectKey: 'skill-doc' },
});
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => {
    resolve = done;
  });
  return { resolve, promise };
};

const Host = ({ scope = 'employee-1' }: { scope?: string }) => {
  const panels = useDetailPanelState();
  useDetailPanelLifecycle({ ...panels, scope, pathname: '/skillCenter', preserveDetailPanel: true });
  React.useEffect(() => {
    panels.openDetailPanel(<input key={scope} aria-label="employee search" defaultValue={scope} />);
  }, [panels.openDetailPanel, scope]);
  const actions = useWorkspaceSkillActions({
    resourceId: scope,
    setDetailPanel: panels.openDetailPanel,
    clearDetailPanel: panels.clearDetailPanel,
    openTemporaryDetailPanel: panels.openTemporaryDetailPanel,
  });
  return (
    <>
      <button onClick={() => actions.openDetail(skill)}>first</button>
      <button onClick={() => actions.openDetail({ ...skill, skillPath: '/skills/second' })}>second</button>
      <button onClick={panels.clearDetailPanel}>close workspace</button>
      <DetailPanelContent {...panels} />
    </>
  );
};

beforeEach(() => jest.resetAllMocks());

it.each(['close', 'clear', 'scope', 'history'])('ignores a pending detail response after %s', async (action) => {
  const pending = deferred();
  query.mockReturnValue(pending.promise);
  const view = render(<Host />);
  const original = screen.getByRole('textbox');
  fireEvent.click(screen.getByRole('button', { name: 'first' }));
  expect(screen.getByText('loading')).toBeInTheDocument();
  expect(original).not.toBeVisible();
  if (action === 'close') fireEvent.click(screen.getByRole('button', { name: 'close detail' }));
  if (action === 'clear') fireEvent.click(screen.getByRole('button', { name: 'close workspace' }));
  if (action === 'scope') view.rerender(<Host scope="employee-2" />);
  if (action === 'history') act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  await act(async () => pending.resolve(response('Late response')));
  expect(screen.queryByTestId('detail')).not.toBeInTheDocument();
  if (action === 'close') {
    expect(screen.getByRole('textbox')).toBe(original);
    expect(original).toHaveValue('employee-1');
  } else if (action === 'scope') {
    expect(screen.getByRole('textbox')).toHaveValue('employee-2');
  } else {
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  }
});

it('keeps a failed detail closable and restores the original employee panel', async () => {
  query.mockRejectedValue(new Error('request failed'));
  render(<Host />);
  const original = screen.getByRole('textbox');
  fireEvent.click(screen.getByRole('button', { name: 'first' }));
  expect(await screen.findByText('unavailable')).toBeInTheDocument();
  expect(message.error).toHaveBeenCalledWith('request failed');
  fireEvent.click(screen.getByRole('button', { name: 'close detail' }));
  expect(screen.getByRole('textbox')).toBe(original);
});

it('keeps the latest clicked skill when requests finish in reverse order', async () => {
  const first = deferred();
  query.mockReturnValueOnce(first.promise).mockResolvedValueOnce(response('Second detail'));
  render(<Host />);
  const original = screen.getByRole('textbox');
  fireEvent.click(screen.getByRole('button', { name: 'first' }));
  fireEvent.click(screen.getByRole('button', { name: 'second' }));
  expect(await screen.findByText('Second detail')).toBeInTheDocument();
  await act(async () => first.resolve(response('Stale first detail')));
  expect(screen.queryByText('Stale first detail')).not.toBeInTheDocument();
  expect(screen.getByText('Second detail')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'close detail' }));
  expect(screen.getByRole('textbox')).toBe(original);
});

it('retains the existing host tab callbacks for employee workspace skill details', async () => {
  query.mockResolvedValue(response('Employee skill'));
  jest.mocked(queryResourceMembers).mockResolvedValue({ managerList: [], resourceName: 'Employee' } as any);
  const setDetailPanel = jest.fn();
  const clearDetailPanel = jest.fn();
  const { result } = renderHook(() =>
    useWorkspaceSkillActions({ resourceId: 'employee-1', setDetailPanel, clearDetailPanel })
  );
  act(() => result.current.openDetail({ ...skill, personalWorkspace: false }));
  expect(setDetailPanel).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ tabKey: 'workspace-skill:/skills/first' })
  );
  render(setDetailPanel.mock.calls[0][0]);
  expect(await screen.findByText('Employee skill')).toBeInTheDocument();
  expect(query).toHaveBeenCalledWith({ skillPath: '/skills/first', resourceId: 'employee-1', userCode: 'user-1' });
  expect(queryResourceMembers).toHaveBeenCalledWith({ resourceId: 'employee-1' });
  fireEvent.click(screen.getByRole('button', { name: 'close detail' }));
  expect(clearDetailPanel).toHaveBeenCalledTimes(1);
});
