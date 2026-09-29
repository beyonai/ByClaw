import { fireEvent, render, screen } from '@testing-library/react';
import FileMgr from '..';
import routes from '../../../../../../config/route.config';

let mockState: any;

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  useSelector: (selector: (state: any) => any) => selector(mockState),
}));

jest.mock('@/utils/agent', () => ({ getAgentChatAvatar: () => null }));

// 保留真实 FilesPage 和员工选择逻辑，只替换文件网络操作与预览渲染器。
jest.mock('@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel', () => {
  const { default: useGlobal } = jest.requireActual('@/hooks/useGlobal');

  return {
    __esModule: true,
    default: ({ resourceId }: { resourceId: string }) => {
      const { EventEmitter } = useGlobal();
      return (
        <button
          onClick={() => {
            EventEmitter.emit('beyond-main-driver-open-type', { drawerType: 'preview', title: 'report.pdf' });
            EventEmitter.emit('beyond-main-driver-message', { title: 'report.pdf' });
          }}
        >
          {resourceId}
        </button>
      );
    },
  };
});

jest.mock('@/components/MainDrawer', () => {
  const { default: useDrawerEvents } = jest.requireActual('@/components/MainDrawer/useEventEmitter');

  return {
    __esModule: true,
    default: () => {
      const { drawerType, contentPayload } = useDrawerEvents();
      return drawerType === 'preview' ? <div>{contentPayload.title}</div> : null;
    },
  };
});

describe('FileMgr', () => {
  beforeEach(() => {
    mockState = {
      user: { userInfo: { defaultDigEmployeeId: '90001' } },
      employees: { defaultDigEmployeeId: '', employeesList: [], agentList: [] },
    };
  });

  it('registers the file page under the enterprise manager layout', () => {
    const manager = routes.find((route) => route.path === '/')?.routes?.find((route) => route.path === '/manager');

    expect(manager?.routes).toContainEqual({
      path: '/manager/files',
      name: 'managerFiles',
      component: './manager/pages/FileMgr',
    });
  });

  it('loads the original file module with the user default employee and supports preview events', () => {
    const { rerender } = render(<FileMgr />);

    expect(screen.getByRole('heading', { name: 'menu.fileManagement' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '90001' })).toBeInTheDocument();

    // 父页面重渲染后，文件组件与抽屉仍应使用同一个事件总线。
    rerender(<FileMgr />);
    fireEvent.click(screen.getByRole('button', { name: '90001' }));
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });

  it('waits for a default employee before mounting file operations', () => {
    mockState.user.userInfo = {};
    const { rerender } = render(<FileMgr />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    mockState.employees.defaultDigEmployeeId = '90002';
    rerender(<FileMgr />);
    expect(screen.getByRole('button', { name: '90002' })).toBeInTheDocument();
  });
});
