import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import KnowledgeDetail from '..';

const mockNavigate = jest.fn();
const mockQueryResourceDetail = jest.fn();
const mockDeleteKnowledge = jest.fn();
const mockConfirm = jest.fn();
const mockIntl = { formatMessage: ({ id }: { id: string }) => id };
let mockLocationState: any;
let mockSearch = '';

jest.mock('@umijs/max', () => ({
  useIntl: () => mockIntl,
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: mockLocationState }),
  useSearchParams: () => [new URLSearchParams(mockSearch)],
}));

jest.mock('antd', () => ({
  Button: ({ children, icon, ...props }: any) => <button {...props}>{children}</button>,
  Input: () => null,
  Tooltip: ({ children }: any) => children,
  Spin: ({ children }: any) => children,
  Modal: { confirm: (options: unknown) => mockConfirm(options) },
  message: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('@/components/AntdIcon', () => ({
  __esModule: true,
  default: ({ type }: { type: string }) => <span data-testid={type} />,
}));
jest.mock('@/components/CommonTabs', () => ({ __esModule: true, default: () => null }));
jest.mock('@/models/useKnowledgeStore', () => ({
  __esModule: true,
  default: () => ({ queryResourceDetail: mockQueryResourceDetail }),
}));
jest.mock('@/service/knowledgeCenter', () => ({
  queryKnowledgeCapability: jest.fn().mockResolvedValue({ allowKnowledgeBaseDelete: true }),
}));
jest.mock('@/pages/manager/service/resources', () => ({
  deleteKnowledge: (...args: unknown[]) => mockDeleteKnowledge(...args),
}));
jest.mock('@/pages/knowledgeCenter/components/shareModal', () => ({ __esModule: true, default: () => null }));
jest.mock('@/pages/knowledgeCenter/components/VisibleRange', () => ({ __esModule: true, default: () => null }));
jest.mock('../DirectoryManage', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/AddFolderModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/DownloadFile', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/UploadFile', () => ({ __esModule: true, default: () => null }));

describe('KnowledgeDetail return navigation', () => {
  const returnState = { preserveDetailPanel: true, resourceCenterMyResourcesOnly: false };
  const returnPath = '/resourceCenter?resourceTab=knowledge&tab=enterprise#resources';

  beforeEach(() => {
    jest.clearAllMocks();
    mockSearch = '?resourceId=knowledge-1&resourceBizType=KG_DOC&fromTab=enterprise';
    mockLocationState = {
      knowledgeDetailReturnLocation: {
        pathname: '/resourceCenter',
        search: '?resourceTab=knowledge&tab=enterprise',
        hash: '#resources',
        state: returnState,
      },
    };
    mockQueryResourceDetail.mockResolvedValue({
      resourceId: 'knowledge-1',
      resourceName: 'Knowledge',
      operationPermissions: { hasManagePermission: true },
    });
    mockDeleteKnowledge.mockResolvedValue({});
  });

  it('returns to the original resource center route and retains its state', async () => {
    render(<KnowledgeDetail />);
    await screen.findByText('Knowledge');
    fireEvent.click(screen.getByText('layout.back'));

    expect(mockNavigate).toHaveBeenCalledWith(returnPath, { state: returnState });
  });

  it.each(['missing', 'mismatch', 'rejected'])(
    'returns to the resource center when the detail response is %s',
    async (response) => {
      if (response === 'rejected') {
        mockQueryResourceDetail.mockRejectedValue(new Error('Forbidden'));
      } else {
        mockQueryResourceDetail.mockResolvedValue(response === 'missing' ? {} : { resourceId: 'other' });
      }
      render(<KnowledgeDetail />);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(returnPath, { replace: true, state: returnState });
      });
    }
  );

  it('returns to the same resource center after deleting knowledge', async () => {
    render(<KnowledgeDetail />);
    await screen.findByText('Knowledge');
    fireEvent.click(screen.getByTestId('icon-a-Deleteshanchu'));
    expect(mockConfirm).toHaveBeenCalledTimes(1);

    await act(async () => {
      await mockConfirm.mock.calls[0][0].onOk();
    });

    expect(mockDeleteKnowledge).toHaveBeenCalledWith({ resourceId: 'knowledge-1' });
    expect(mockNavigate).toHaveBeenCalledWith(returnPath, { replace: true, state: returnState });
  });

  it('preserves the independent knowledge center entry', async () => {
    mockLocationState.knowledgeDetailReturnLocation = {
      pathname: '/knowledgeCenter',
      search: '?tab=personal',
      state: { preserveDetailPanel: true },
    };
    render(<KnowledgeDetail />);
    await screen.findByText('Knowledge');
    fireEvent.click(screen.getByText('layout.back'));

    expect(mockNavigate).toHaveBeenCalledWith('/knowledgeCenter?tab=personal', {
      state: { preserveDetailPanel: true },
    });
  });

  it.each(['personal', 'enterprise', 'unknown'])(
    'keeps old detail links with fromTab=%s usable without return state',
    async (tab) => {
      mockSearch = `?resourceId=knowledge-1&fromTab=${tab}`;
      mockLocationState = undefined;
      render(<KnowledgeDetail />);
      await screen.findByText('Knowledge');
      fireEvent.click(screen.getByText('layout.back'));

      const path = tab === 'unknown' ? '/knowledgeCenter' : `/knowledgeCenter?tab=${tab}`;
      expect(mockNavigate).toHaveBeenCalledWith(path, { state: undefined });
    }
  );
});
