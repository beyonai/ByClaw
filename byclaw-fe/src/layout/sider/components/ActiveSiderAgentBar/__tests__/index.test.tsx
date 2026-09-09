import { renderHook } from '@testing-library/react';

let mockGlobalContext: any;
let mockAppState: any;

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => mockGlobalContext,
}));

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ defaultMessage, id }: any) => defaultMessage || id }),
  useSelector: (selector: (state: any) => any) => selector(mockAppState),
}));

import { useActiveSiderAgent } from '..';

describe('useActiveSiderAgent', () => {
  beforeEach(() => {
    mockGlobalContext = {
      agentId: 'employee-record-id',
      agentInfo: undefined,
      siderAgentId: '',
    };
    mockAppState = {
      user: { userInfo: {} },
      employees: {
        defaultDigEmployeeId: '',
        agentList: [],
        employeesList: [
          {
            id: 'employee-record-id',
            agentId: 'employee-record-id',
            resourceId: '90001',
            resourceName: '代码助手',
          },
        ],
      },
    };
  });

  it('normalizes a session employee id to the portal resource id', () => {
    const { result } = renderHook(() => useActiveSiderAgent());

    expect(result.current).toMatchObject({
      resourceId: '90001',
      name: '代码助手',
    });
  });

  it('prefers the current agent resource id when agentInfo is available', () => {
    mockGlobalContext.agentInfo = {
      agentId: 'employee-record-id',
      resourceId: '90002',
      resourceName: '当前员工',
    };

    const { result } = renderHook(() => useActiveSiderAgent());

    expect(result.current).toMatchObject({
      resourceId: '90002',
      name: '当前员工',
    });
  });

  it('does not treat an unmatched session object id as a resource id', () => {
    mockAppState.employees.employeesList = [];

    const { result } = renderHook(() => useActiveSiderAgent());

    expect(result.current.resourceId).toBeUndefined();
  });

  it('uses the resource id explicitly selected by the current mention', () => {
    mockGlobalContext = {
      agentId: 'stale-session-object-id',
      agentInfo: undefined,
      siderAgentId: '90003',
    };
    mockAppState.employees.employeesList = [];

    const { result } = renderHook(() => useActiveSiderAgent());

    expect(result.current.resourceId).toBe('90003');
  });
});
