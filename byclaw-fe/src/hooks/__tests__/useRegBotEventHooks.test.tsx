jest.mock('@umijs/max', () => ({
  useSelector: jest.fn(),
  useDispatch: jest.fn(),
  useNavigate: jest.fn(),
  getIntl: jest.fn(() => ({
    formatMessage: ({ id }: { id: string }) => id,
  })),
}));

jest.mock('antd', () => ({
  message: {
    error: jest.fn(),
  },
}));

jest.mock('../useGlobal', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('@/models/common/useAppStore', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../useResourceDetail', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('@/service/task', () => ({
  createTaskConversation: jest.fn(),
  updateResCom: jest.fn(),
  updateTask: jest.fn(),
  approveTask: jest.fn(),
}));

jest.mock('@/utils', () => ({
  getModelState: jest.fn(() => ({})),
  getRootPagePath: jest.fn(() => '/chat'),
}));

jest.mock('@/utils/bot', () => ({
  ssoLoginByIframe: jest.fn(),
}));

import { renderHook, act } from '@testing-library/react';
import { useDispatch, useNavigate, useSelector } from '@umijs/max';
import useGlobal from '../useGlobal';
import useAppStore from '@/models/common/useAppStore';
import useResourceDetail from '../useResourceDetail';
import { ssoLoginByIframe } from '@/utils/bot';
import useRegBotEventHooks from '../useRegBotEventHooks';

const mockUseSelector = useSelector as jest.Mock;
const mockUseDispatch = useDispatch as jest.Mock;
const mockUseNavigate = useNavigate as jest.Mock;
const mockUseGlobal = useGlobal as jest.MockedFunction<typeof useGlobal>;
const mockUseAppStore = useAppStore as jest.Mock;
const mockUseResourceDetail = useResourceDetail as jest.Mock;

describe('hooks/useRegBotEventHooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDispatch.mockReturnValue(jest.fn().mockResolvedValue(undefined));
    mockUseNavigate.mockReturnValue(jest.fn());
    mockUseSelector.mockImplementation((selector: any) =>
      selector({
        employees: {
          employeesList: [{ id: '1', agentId: 'a1', resourceCode: 'agent-code' }],
          agentList: [],
        },
      })
    );
    mockUseGlobal.mockReturnValue({
      setAgentId: jest.fn(),
      setSessionId: jest.fn(),
      EventEmitter: { emit: jest.fn() },
    } as any);
    mockUseAppStore.mockReturnValue({
      setSiderCollapsed: jest.fn(),
      setUserCollectModalOpen: jest.fn(),
      setLoginModalOpen: jest.fn(),
    });
    mockUseResourceDetail.mockReturnValue({
      handleResourceDetail: jest.fn(),
    });
  });

  it('emits chat send event directly when taskId is absent', async () => {
    const EventEmitter = { emit: jest.fn() };
    mockUseGlobal.mockReturnValue({
      setAgentId: jest.fn(),
      setSessionId: jest.fn(),
      EventEmitter,
    } as any);
    mockUseSelector.mockImplementation((selector: any) =>
      selector({
        employees: {
          employeesList: [{ id: '1', agentId: 'a1', resourceCode: 'agent-code' }],
          agentList: [],
        },
        user: {
          userInfo: {
            isRetented: true,
          },
        },
      })
    );

    const setSpinning = jest.fn();
    const { result } = renderHook(() =>
      useRegBotEventHooks({
        loadSsoIframeUrl: 'https://sso',
        setSpinning,
      })
    );

    await act(async () => {
      await result.current.sendChatMessage({
        content: 'hello',
        params: {
          toResCode: 'agent-code',
          extParam: { foo: 'bar' },
        },
      });
    });

    expect(ssoLoginByIframe).toHaveBeenCalledWith('https://sso');
    expect(EventEmitter.emit).toHaveBeenCalledWith('beyond-chat-on-send-msg', {
      sendProps: {
        queryQuestion: 'hello',
        payload: {
          agentId: 'a1',
          extParams: { foo: 'bar' },
        },
        msgOpt: {
          answerMsg: {
            agentId: 'a1',
            agentType: '010',
          },
        },
      },
    });
    expect(setSpinning).toHaveBeenLastCalledWith(false);
  });

  it('pageFunc handles iframe sso and app page open flows', () => {
    const EventEmitter = { emit: jest.fn() };
    const setSiderCollapsed = jest.fn();
    mockUseGlobal.mockReturnValue({
      setAgentId: jest.fn(),
      setSessionId: jest.fn(),
      EventEmitter,
    } as any);
    mockUseAppStore.mockReturnValue({
      setSiderCollapsed,
      setUserCollectModalOpen: jest.fn(),
      setLoginModalOpen: jest.fn(),
    });

    const { result } = renderHook(() =>
      useRegBotEventHooks({
        stepId: 'step-1',
        stepTaskId: 'step-task-1',
        setSpinning: jest.fn(),
      })
    );

    act(() => {
      result.current.pageFunc({ url: 'https://sso' }, { value: 'byaiLoadSsoIframUrl' });
      result.current.pageFunc({ url: 'https://app/page', param: {} }, { value: 'openByaiAppPage' });
    });

    expect(ssoLoginByIframe).toHaveBeenCalledWith('https://sso');
    expect(setSiderCollapsed).toHaveBeenCalledWith(true);
    expect(EventEmitter.emit).toHaveBeenCalledWith('beyond-minor-driver-open-type', {
      drawerType: 'iframe',
      canClose: true,
      canFullScreen: true,
    });
    expect(EventEmitter.emit).toHaveBeenCalledWith('beyond-minor-driver-message', { url: 'https://app/page' });
  });

  it('byaiCustom delegates resource detail opening', () => {
    const handleResourceDetail = jest.fn();
    mockUseResourceDetail.mockReturnValue({ handleResourceDetail });

    const { result } = renderHook(() =>
      useRegBotEventHooks({
        setSpinning: jest.fn(),
      })
    );

    act(() => {
      result.current.byaiCustom(
        {
          substance: { resourceId: 'r1' },
        },
        {
          type: 'custom',
          value: 'resourceDetail',
          bId: 'b1',
        }
      );
    });

    expect(handleResourceDetail).toHaveBeenCalledWith({ resourceId: 'r1' });
  });
});
