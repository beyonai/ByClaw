import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ModelsPage from '..';
import { deleteMyModel, getMyModels, getPublicModels, getMyModelDetail } from '../service';
import { refreshCachedModelHealth, removeCachedModelHealth } from '@/service/modelHealth';
import { POST } from '@/service/common/request';

let mockSearch = '?tab=mine&healthModelId=42';
let mockLocationState: Record<string, any> | null = null;
const mockHandleShow = jest.fn();
const mockNavigate = jest.fn();
jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: any, values: Record<string, any> = {}) =>
      (require('@/locales/en-US/manager').default[id] || id).replace(
        /\{(\w+)\}/g,
        (_: string, key: string) => `${values[key]}`
      ),
  }),
  useLocation: () => ({ search: mockSearch, state: mockLocationState, pathname: '/models' }),
  useNavigate: () => mockNavigate,
  useSelector: (selector: any) => selector({ user: { userInfo: { userId: 17 } }, employees: {} }),
}));
jest.mock('@/hooks/useGlobal', () => () => ({}));
jest.mock('@/service/digitalEmployees', () => ({ getCompositeAppInfo: jest.fn() }));
jest.mock('@/pages/manager/hooks/useShowModal', () => () => [{}, { handleShow: mockHandleShow, onCancel: jest.fn() }]);
jest.mock('../components/ModelFormModal', () => () => null);
jest.mock('../components/QuotaCard', () => () => null);
jest.mock('../components/ModelCard', () => ({ data, onDelete, healthIndicator }: any) => (
  <div>
    {data.displayName}
    {healthIndicator}
    <button onClick={onDelete}>Delete</button>
  </div>
));
jest.mock('../components/PublicModelCard', () => ({ record, healthIndicator }: any) => (
  <div>
    {record.displayName}
    {healthIndicator}
  </div>
));
jest.mock('@/components/CommonTabs', () => ({ activeKey, onChange }: any) => (
  <div data-testid="active-tab">
    {activeKey}
    <button onClick={() => onChange('mine')}>My tab</button>
    <button onClick={() => onChange('public')}>Public tab</button>
  </div>
));
jest.mock('react-infinite-scroll-component', () => ({ children }: any) => <div>{children}</div>);
jest.mock('../service', () => ({
  getMyModels: jest.fn(),
  getMyModelDetail: jest.fn(),
  getPublicModels: jest.fn(),
  getMyQuota: jest.fn(async () => ({})),
  deleteMyModel: jest.fn(),
}));
jest.mock('@/service/modelHealth', () => ({
  ...jest.requireActual('@/service/modelHealth'),
  removeCachedModelHealth: jest.fn(),
}));
jest.mock('@/service/common/request', () => ({ POST: jest.fn() }));
jest.mock('@/utils/auth', () => ({ getAuthSnapshot: () => ({}), isCurrentAuthSnapshot: () => true }));

const reports: Record<string, any> = {};
beforeEach(async () => {
  jest.clearAllMocks();
  mockLocationState = null;
  delete reports.PERSONAL;
  delete reports.PUBLIC;
  (POST as jest.Mock).mockImplementation(async (url, params) => ({
    code: 0,
    data: url.endsWith('/healthCache') ? reports[params.scope] || null : true,
  }));
  await refreshCachedModelHealth({ userId: 17 }, 'PERSONAL');
  await refreshCachedModelHealth({ userId: 17 }, 'PUBLIC');
  (getMyModels as jest.Mock).mockResolvedValue({
    code: 0,
    data: { rows: [{ id: '42', displayName: 'Target model' }], total: 1 },
  });
  (getPublicModels as jest.Mock).mockResolvedValue({
    code: 0,
    data: { rows: [{ id: '42', displayName: 'Target model' }], total: 1 },
  });
});

it.each(['mine', 'public'])('shows cached failures on direct entry to the %s tab without probing', async (tab) => {
  mockSearch = `?tab=${tab}`;
  const scope = tab === 'mine' ? 'PERSONAL' : 'PUBLIC';
  reports[scope] = {
    scope,
    checkedAt: Date.now(),
    healthy: false,
    dismissed: true,
    presented: true,
    models: [
      { modelId: '42', modelName: 'Target model', modelType: 'LLM', status: 'FAILED', errorCode: 'AUTH_FAILED' },
    ],
  };
  render(<ModelsPage />);
  expect(await screen.findByRole('button', { name: 'View check details for Target model' })).toBeInTheDocument();
  expect(screen.getByText('Last check: 1 issue(s) in total')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect((POST as jest.Mock).mock.calls.every(([url]) => url.endsWith('/healthCache'))).toBe(true);
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('shows personal 1 plus public 2 as 3 total regardless of the selected tab', async () => {
  mockSearch = '?tab=mine';
  for (const scope of ['PERSONAL', 'PUBLIC'] as const) {
    reports[scope] = {
      scope,
      checkedAt: Date.now(),
      healthy: false,
      dismissed: true,
      presented: true,
      models: Array.from({ length: scope === 'PERSONAL' ? 1 : 2 }, (_, index) => ({
        modelId: `${42 + index}`,
        modelName: `Broken ${scope} ${index}`,
        modelType: 'LLM',
        status: 'FAILED',
        errorCode: 'AUTH_FAILED',
      })),
    };
    await refreshCachedModelHealth({ userId: 17 }, scope);
  }
  (POST as jest.Mock).mockClear();
  render(<ModelsPage />);
  await screen.findByText('Target model');
  expect(screen.getByRole('status')).toHaveTextContent('Last check: 3 issue(s) in total');
  expect(screen.getByRole('button', { name: 'Personal models: 1 issue(s) · View details' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Public models: 2 issue(s) · View details' })).toBeInTheDocument();
  fireEvent.click(screen.getByText('Public tab'));
  await waitFor(() => expect(getPublicModels).toHaveBeenCalled());
  expect(screen.getByRole('status')).toHaveTextContent('Last check: 3 issue(s) in total');
  expect(screen.getByRole('button', { name: 'View check details for Broken PUBLIC 0' })).toBeInTheDocument();
  fireEvent.click(screen.getByText('My tab'));
  expect(screen.getByRole('status')).toHaveTextContent('Last check: 3 issue(s) in total');
  expect(screen.getByRole('button', { name: 'View check details for Broken PERSONAL 0' })).toBeInTheDocument();
  expect((POST as jest.Mock).mock.calls.every(([url]) => url.endsWith('/healthCache'))).toBe(true);
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('clears the exact-model filter after deleting the focused model', async () => {
  mockSearch = '?tab=mine&healthModelId=42';
  (deleteMyModel as jest.Mock).mockResolvedValue({ code: 0, data: true });
  const view = render(<ModelsPage />);
  fireEvent.click(await screen.findByText('Delete'));
  await waitFor(() => expect(mockNavigate).toHaveBeenLastCalledWith('/models?tab=mine', { replace: true }));
  expect(deleteMyModel).toHaveBeenCalledWith({ id: '42' });
  mockSearch = '?tab=mine';
  view.rerender(<ModelsPage />);
  await waitFor(() =>
    expect(getMyModels).toHaveBeenLastCalledWith(expect.objectContaining({ modelId: undefined, pageNum: 1 }))
  );
  expect(screen.queryByText('Showing the model that needs attention')).not.toBeInTheDocument();
});

it.each(['mine', 'public'])('repairs a stale %s target using a successful empty exact-ID lookup', async (tab) => {
  mockSearch = `?tab=${tab}&healthModelId=gone`;
  const request = tab === 'mine' ? getMyModels : getPublicModels;
  (request as jest.Mock).mockResolvedValue({ code: 0, data: { rows: [], total: 0 } });
  render(<ModelsPage />);
  await waitFor(() => expect(removeCachedModelHealth).toHaveBeenCalledWith('gone'));
  expect(mockNavigate).toHaveBeenCalledWith(`/models?tab=${tab}`, { replace: true });
  expect(screen.queryByText('Showing the model that needs attention')).not.toBeInTheDocument();
});

it('does not discard a cached failure when the list request fails', async () => {
  mockSearch = '?tab=mine&healthModelId=42';
  (getMyModels as jest.Mock).mockResolvedValue({ code: 500, data: { rows: [] } });
  render(<ModelsPage />);
  await waitFor(() => expect(getMyModels).toHaveBeenCalled());
  expect(removeCachedModelHealth).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
});

it.each(['mine', 'public'])('opens the %s tab and finds the exact model without relying on pagination', async (tab) => {
  mockSearch = `?tab=${tab}&healthModelId=42`;
  render(<ModelsPage />);
  await waitFor(() => expect(screen.getByTestId('active-tab')).toHaveTextContent(tab));
  const request = tab === 'mine' ? getMyModels : getPublicModels;
  await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({ modelId: '42', pageNum: 1 })));
  expect(await screen.findByText('Target model')).toBeInTheDocument();
  expect(screen.getByText('Target model').parentElement).toHaveClass('healthTarget');
});

it('consumes a personal edit action and keeps its positioning URL safe to refresh', async () => {
  mockSearch = '?tab=mine&healthModelId=42';
  mockLocationState = { editModelId: '42', editModelRequestId: 1 };
  (getMyModelDetail as jest.Mock).mockResolvedValue({ code: 0, data: { id: '42' } });
  const view = render(<ModelsPage />);
  await waitFor(() => expect(mockHandleShow).toHaveBeenCalledWith('edit', { id: '42' }));
  expect(mockNavigate).toHaveBeenCalledWith('/models?tab=mine&healthModelId=42', { replace: true, state: {} });
  mockHandleShow.mockClear();
  (getMyModelDetail as jest.Mock).mockClear();
  mockLocationState = {};
  view.rerender(<ModelsPage />);
  view.unmount();
  render(<ModelsPage />);
  await screen.findByText('Target model');
  expect(getMyModelDetail).not.toHaveBeenCalled();
  expect(mockHandleShow).not.toHaveBeenCalled();
});
