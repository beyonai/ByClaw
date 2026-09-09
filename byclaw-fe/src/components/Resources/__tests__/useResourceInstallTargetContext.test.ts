import { renderHook } from '@testing-library/react';

let mockLocationState: unknown;
let mockActiveSiderAgent: { resourceId?: string; name: string };

jest.mock('@umijs/max', () => ({
  useLocation: () => ({ state: mockLocationState }),
}));

jest.mock('@/layout/sider/components/ActiveSiderAgentBar', () => ({
  useActiveSiderAgent: () => mockActiveSiderAgent,
}));

import useResourceInstallTargetContext from '../useResourceInstallTargetContext';

describe('useResourceInstallTargetContext', () => {
  beforeEach(() => {
    mockLocationState = undefined;
    mockActiveSiderAgent = { name: '' };
  });

  it('keeps entry one in employee selection mode', () => {
    mockActiveSiderAgent = { resourceId: '90001', name: '当前员工' };

    const { result } = renderHook(() => useResourceInstallTargetContext());

    expect(result.current).toEqual({ mode: 'select' });
  });

  it('uses the live employee shown by the current employee panel for entry two', () => {
    mockLocationState = {
      resourceInstallContext: {
        source: 'currentEmployee',
        digitalEmployeeId: 'stale-id',
        digitalEmployeeName: '旧员工',
      },
    };
    mockActiveSiderAgent = { resourceId: '90002', name: '当前员工' };

    const { result } = renderHook(() => useResourceInstallTargetContext());

    expect(result.current).toEqual({
      mode: 'fixed',
      digitalEmployeeId: '90002',
      digitalEmployeeName: '当前员工',
    });
  });

  it('blocks installation when entry two has no valid current employee', () => {
    mockLocationState = {
      resourceInstallContext: {
        source: 'currentEmployee',
        digitalEmployeeId: 'stale-id',
        digitalEmployeeName: '旧员工',
      },
    };

    const { result } = renderHook(() => useResourceInstallTargetContext());

    expect(result.current).toEqual({
      mode: 'unavailable',
      digitalEmployeeName: '旧员工',
    });
  });
});
