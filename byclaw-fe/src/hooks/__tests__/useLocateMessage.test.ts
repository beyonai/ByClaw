jest.mock('@umijs/max', () => ({
  useDispatch: jest.fn(),
  useNavigate: jest.fn(),
  useSelector: jest.fn(),
}));

jest.mock('@/service/common/request', () => ({
  POST: jest.fn(),
}));

jest.mock('@/utils', () => ({
  getRootPagePath: jest.fn(() => '/chat'),
}));

jest.mock('../useGlobal', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('@/utils/agent', () => ({
  getAgentPath: jest.fn(() => '/employees/1'),
}));

import { renderHook, act } from '@testing-library/react';
import { POST } from '@/service/common/request';
import { useDispatch, useNavigate, useSelector } from '@umijs/max';
import useGlobal from '../useGlobal';
import useLocateMessage from '../useLocateMessage';

const mockPOST = POST as jest.MockedFunction<typeof POST>;
const mockUseDispatch = useDispatch as jest.Mock;
const mockUseNavigate = useNavigate as jest.Mock;
const mockUseSelector = useSelector as jest.Mock;
const mockUseGlobal = useGlobal as jest.MockedFunction<typeof useGlobal>;

describe('hooks/useLocateMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockUseDispatch.mockReturnValue(jest.fn().mockResolvedValue(undefined));
    mockUseNavigate.mockReturnValue(jest.fn());
    mockUseSelector.mockImplementation((selector: any) =>
      selector({
        employees: {
          agentList: [{ id: 'agent-1', resourceCode: 'agent-1' }],
          employeesList: [],
        },
      })
    );
    mockUseGlobal.mockReturnValue({
      setSessionId: jest.fn(),
      setAgentId: jest.fn(),
    } as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('dispatches locate data and navigates to agent path', async () => {
    const dispatch = mockUseDispatch.mock.results[0]?.value || mockUseDispatch();
    const navigate = mockUseNavigate.mock.results[0]?.value || mockUseNavigate();
    mockPOST.mockResolvedValue({ position: 5, totalCount: 20 } as any);

    const { result } = renderHook(() => useLocateMessage());

    await act(async () => {
      await result.current({
        sessionId: 'session-1',
        messageId: 'message-1',
        agentId: 'agent-1',
      });
    });

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/showcase/messages/count', {
      sessionId: 'session-1',
      messageId: 'message-1',
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'messageStore/setInitialSessionDataToLocateMsg',
      payload: {
        sessionId: 'session-1',
        index: 5,
        total: 20,
        targetMessageId: 'message-1',
      },
    });

    act(() => {
      jest.runAllTimers();
    });

    expect((mockUseGlobal.mock.results[0]?.value as any).setSessionId).toHaveBeenCalledWith('session-1');
    expect((mockUseGlobal.mock.results[0]?.value as any).setAgentId).toHaveBeenCalledWith('agent-1');
    expect(navigate).toHaveBeenCalledWith('/employees/1');
  });

  it('falls back to root path and swallows request errors', async () => {
    const navigate = mockUseNavigate.mock.results[0]?.value || mockUseNavigate();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockPOST.mockRejectedValue(new Error('failed'));
    mockUseSelector.mockImplementation((selector: any) =>
      selector({
        employees: {
          agentList: [],
          employeesList: [],
        },
      })
    );

    const { result } = renderHook(() => useLocateMessage());

    await act(async () => {
      await result.current({
        sessionId: 'session-1',
        messageId: 'message-1',
        agentId: '',
      });
    });

    act(() => {
      jest.runAllTimers();
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });
});
