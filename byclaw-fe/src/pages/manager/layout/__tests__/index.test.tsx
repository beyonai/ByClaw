import { render } from '@testing-library/react';
import { useDispatch, useSelector } from '@umijs/max';

import ManagerLayout from '../index';

jest.mock('@umijs/max', () => ({
  getLocale: jest.fn(() => 'zh-CN'),
  Outlet: () => null,
  useDispatch: jest.fn(),
  useLocation: jest.fn(() => ({ pathname: '/manager' })),
  useSelector: jest.fn(),
}));

jest.mock('@/layout/auth', () => ({
  __esModule: true,
  default: ({ children }: { children: JSX.Element }) => children,
}));

jest.mock('@/pages/manager/layout/provider/antd', () => ({
  __esModule: true,
  default: ({ children }: { children: JSX.Element }) => children,
}));

jest.mock('../sider', () => ({
  __esModule: true,
  default: () => null,
}));

const mockUseDispatch = useDispatch as jest.Mock;
const mockUseSelector = useSelector as jest.Mock;
const dispatch = jest.fn();

describe('ManagerLayout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDispatch.mockReturnValue(dispatch);
  });

  it('does not load protected menu config before login', () => {
    mockUseSelector.mockImplementation((selector: any) =>
      selector({
        user: {
          userInfo: null,
        },
      })
    );

    render(<ManagerLayout />);

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('loads protected menu config after login', () => {
    mockUseSelector.mockImplementation((selector: any) =>
      selector({
        user: {
          userInfo: {
            userId: 10000022,
          },
        },
      })
    );

    render(<ManagerLayout />);

    expect(dispatch).toHaveBeenCalledWith({
      type: 'menu/getBlockedPaths',
      payload: {
        paramCode: 'BYAI_MIN_SYSTEM_MENU',
      },
    });
  });
});
