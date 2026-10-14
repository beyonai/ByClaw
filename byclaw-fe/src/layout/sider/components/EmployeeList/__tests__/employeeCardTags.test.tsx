import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import EmployeeCard from '../EmployeeCard';
import { EmployeeListContext } from '..';

const mockIntl = { formatMessage: ({ id }: { id: string }) => id };
jest.mock('@umijs/max', () => ({
  useIntl: () => mockIntl,
  useNavigate: () => jest.fn(),
  useDispatch: () => jest.fn(),
}));
jest.mock('..', () => ({
  EmployeeListContext: jest.requireActual('react').createContext({}),
  isInputMode: (mode: string) => mode === 'expert',
}));
jest.mock('@/hooks/useGlobal', () => ({ __esModule: true, default: () => ({}) }));
jest.mock('@/hooks/useTracker', () => ({ __esModule: true, default: () => ({ trackerEmployeeClick: jest.fn() }) }));
jest.mock('@/utils/agent', () => ({ agentHandler: (row: any) => row, getAgentChatAvatar: () => null }));
jest.mock('@/utils/openClaw/utils', () => ({ isOpenClawAgent: () => false }));
jest.mock('@/components/AntdIcon', () => () => null);
jest.mock(
  '@/pages/employees/components/EmployeesDrawer',
  () =>
    ({ children }: any) =>
      children
);
jest.mock('@/pages/digitalEmployees/components/AllDigitalEmployees/RenderRightBottom', () => ({
  UnApplyButton: () => null,
}));

describe('employee picker default tags', () => {
  const originalObserver = global.IntersectionObserver;

  beforeEach(() => {
    jest.useFakeTimers();
    global.IntersectionObserver = jest.fn().mockImplementation((callback) => ({
      observe: () => callback([{ intersectionRatio: 1 }]),
      disconnect: jest.fn(),
    })) as any;
  });

  afterEach(() => {
    cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
    global.IntersectionObserver = originalObserver;
  });

  it.each([
    ['001', true],
    ['001', false],
    ['017', true],
    ['017', false],
  ])('shows only the default tag for picker employee type %s, default %s', (agentType, isDefault) => {
    const onSelect = jest.fn();
    const employee = { agentId: 'employee-1', name: 'Candidate', agentType, isDefault, tagName: '数字员工组' };
    render(
      <EmployeeListContext.Provider value={{ chatMode: 'expert' as any }}>
        <EmployeeCard employee={employee as any} onSelect={onSelect} />
      </EmployeeListContext.Provider>
    );
    act(() => jest.advanceTimersByTime(300));

    expect(Boolean(screen.queryByText('resource.defaultDigitalEmployee'))).toBe(isDefault);
    expect(screen.queryByText('数字员工组')).toBeNull();
    fireEvent.click(screen.getByText('Candidate'));
    expect(onSelect).toHaveBeenCalledWith(employee);
  });

  it('keeps the group type tag in the sidebar', () => {
    render(
      <EmployeeCard
        employee={
          { agentId: 'group-1', name: 'Group', agentType: '017', isDefault: false, tagName: '数字员工组' } as any
        }
        onSelect={jest.fn()}
      />
    );
    act(() => jest.advanceTimersByTime(300));

    expect(screen.getByText('数字员工组')).toBeInTheDocument();
    expect(screen.queryByText('resource.defaultDigitalEmployee')).toBeNull();
  });
});
