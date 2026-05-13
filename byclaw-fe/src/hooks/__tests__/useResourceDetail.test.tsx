jest.mock('@umijs/max', () => ({
  useSelector: jest.fn(),
}));

jest.mock('antd', () => ({
  message: {
    error: jest.fn(),
  },
}));

jest.mock('@/pages/employees/components/EmployeesDrawer', () => ({
  __esModule: true,
  default: (props: any) => ({ type: 'EmployeesDrawer', props }),
}));

jest.mock('@/pages/employees/components/SkillDetailDrawer/SkillDetailDrawer', () => ({
  __esModule: true,
  default: (props: any) => ({ type: 'SkillDetailDrawer', props }),
}));

jest.mock('@/components/MessageList/utils', () => ({
  getResponseAgentInfo: jest.fn(() => ({ agentId: 'a1', name: 'Agent' })),
}));

jest.mock('../useGlobal', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { renderHook, act } from '@testing-library/react';
import { useSelector } from '@umijs/max';
import { message } from 'antd';
import useGlobal from '../useGlobal';
import useResourceDetail from '../useResourceDetail';
import { ResourceTypeMap } from '@/constants/resource';

const mockUseSelector = useSelector as jest.Mock;
const mockUseGlobal = useGlobal as jest.MockedFunction<typeof useGlobal>;

describe('hooks/useResourceDetail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSelector.mockImplementation((selector: any) =>
      selector({
        employees: {
          agentList: [],
          employeesList: [],
        },
      })
    );
    mockUseGlobal.mockReturnValue({
      EventEmitter: {
        emit: jest.fn(),
      },
    } as any);
  });

  it('opens EmployeesDrawer for digital employee resources', () => {
    const setPortalComp = jest.fn();
    const { result } = renderHook(() => useResourceDetail({ setPortalComp }));

    act(() => {
      result.current.handleResourceDetail({
        resourceBizType: ResourceTypeMap.digitalEmployee,
        resourceId: 'r1',
      } as any);
    });

    const portal = setPortalComp.mock.calls[0][0];
    expect(portal.type.name || portal.type).toContain('default');
  });

  it('opens SkillDetailDrawer for MCP/TOOL/TOOLKIT/Agent resources', () => {
    const setPortalComp = jest.fn();
    const { result } = renderHook(() => useResourceDetail({ setPortalComp }));

    act(() => {
      result.current.handleResourceDetail({
        resourceBizType: ResourceTypeMap.TOOL,
        resourceId: 'tool-1',
      } as any);
    });

    expect(setPortalComp).toHaveBeenCalled();
  });

  it('shows error when taskId is missing for non-resource detail route', () => {
    const setPortalComp = jest.fn();
    const { result } = renderHook(() => useResourceDetail({ setPortalComp }));

    act(() => {
      result.current.handleResourceDetail({
        resourceBizType: 'OTHER',
      } as any);
    });

    expect((message as any).error).toHaveBeenCalledWith('缺少taskId');
  });

  it('emits fullscreen iframe events when taskId exists', () => {
    const setPortalComp = jest.fn();
    const EventEmitter = {
      emit: jest.fn(),
    };
    mockUseGlobal.mockReturnValue({ EventEmitter } as any);

    const { result } = renderHook(() => useResourceDetail({ setPortalComp }));

    act(() => {
      result.current.handleResourceDetail({
        resourceBizType: 'OTHER',
        taskId: 'task-1',
      } as any);
    });

    expect(EventEmitter.emit).toHaveBeenCalledWith('beyond-fullscreen-modal-open-type', {
      canClose: true,
      drawerType: 'iframe',
    });
    expect(EventEmitter.emit).toHaveBeenCalledWith('beyond-fullscreen-modal-message', {
      url: `${window.location.origin}/manager/todoList/taskDetail?hideCloseBack=1&taskId=task-1`,
    });
  });
});
