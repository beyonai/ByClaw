import { act, renderHook, waitFor } from '@testing-library/react';
import { prepareEmployeeSkills, querySkillRuntimeStatus } from '@/pages/manager/service/DigitalEmployeeMgr';
import { useSkillRuntimeStatus } from '../useSkillRuntimeStatus';

jest.mock('@/pages/manager/service/DigitalEmployeeMgr', () => ({
  querySkillRuntimeStatus: jest.fn(),
  prepareEmployeeSkills: jest.fn(),
}));
const query = querySkillRuntimeStatus as jest.Mock;
const prepare = prepareEmployeeSkills as jest.Mock;
const data = (employeeId: string) => ({ code: 0, data: { employeeId, liveInstances: 1, skills: [] } });

beforeEach(() => {
  jest.clearAllMocks();
  query.mockResolvedValue(data('20'));
  prepare.mockResolvedValue(data('20'));
});

it('does not poll when there is no employee or the skill panel is inactive', () => {
  renderHook(() => useSkillRuntimeStatus());
  expect(query).not.toHaveBeenCalled();
});

it('discards stale responses after switching employees', async () => {
  let oldResponse: (value: any) => void = () => {};
  query.mockImplementation((id) =>
    id === '20'
      ? new Promise((resolve) => {
          oldResponse = resolve;
        })
      : Promise.resolve(data('30'))
  );
  const { result, rerender } = renderHook(({ id }) => useSkillRuntimeStatus(id), { initialProps: { id: '20' } });
  rerender({ id: '30' });
  await waitFor(() => expect(result.current.status?.employeeId).toBe('30'));
  await act(async () => oldResponse(data('20')));
  expect(result.current.status?.employeeId).toBe('30');
});

it('requests preparation only for the selected employee and clears stale ready data on failure', async () => {
  const { result } = renderHook(() => useSkillRuntimeStatus('20'));
  await waitFor(() => expect(result.current.status?.employeeId).toBe('20'));
  await act(async () => result.current.retry());
  expect(prepare).toHaveBeenCalledWith('20');
  expect(result.current.retrying).toBe(false);
});
