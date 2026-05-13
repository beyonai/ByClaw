jest.mock('@/utils/tracker', () => ({
  __esModule: true,
  default: {
    track: jest.fn(),
  },
  getTrackerInfo: jest.fn((type: string, info: any) => ({
    trackerType: type,
    ...info,
  })),
}));

jest.mock('../useGlobal', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('@/utils/agent', () => ({
  getAgentPath: jest.fn(() => '/employees/1'),
}));

import { renderHook, act } from '@testing-library/react';
import TrackerInstance, { getTrackerInfo } from '@/utils/tracker';
import useGlobal from '../useGlobal';
import useTracker from '../useTracker';

const mockUseGlobal = useGlobal as jest.MockedFunction<typeof useGlobal>;

describe('hooks/useTracker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseGlobal.mockReturnValue({
      platform: 'pc',
      agentInfo: { agentId: 'current-agent' },
    } as any);
  });

  it('does not track when clicking the current agent', () => {
    const { result } = renderHook(() => useTracker());

    act(() => {
      result.current.trackerEmployeeClick({ agentId: 'current-agent', name: 'Current' } as any, 'headerEmployeeClick');
    });

    expect((TrackerInstance as any).track).not.toHaveBeenCalled();
  });

  it('tracks employee click for other agents', () => {
    const { result } = renderHook(() => useTracker());

    act(() => {
      result.current.trackerEmployeeClick({ agentId: 'other-agent', name: 'Other' } as any, 'headerEmployeeClick');
    });

    expect(getTrackerInfo).toHaveBeenCalledWith(
      'headerEmployeeClick',
      expect.objectContaining({
        objectId: 'other-agent',
        objectType: 'DIG_EMPLOYEE',
        pagePath: '/employees/1',
        pageTitle: 'Other',
        platform: 'pc',
      })
    );
    expect((TrackerInstance as any).track).toHaveBeenCalledWith(
      'CLICK',
      expect.objectContaining({
        trackerType: 'headerEmployeeClick',
        objectId: 'other-agent',
      })
    );
  });
});
