import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { querySessionDataSources } from '@/service/projectDataSources';
import ResourcePanel from '../ResourcePanel';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ locale: 'zh-CN', formatMessage: ({ id }: { id: string }) => id }),
}));
jest.mock('@/service/projectDataSources', () => ({ querySessionDataSources: jest.fn() }));
jest.mock('@/service/devloop', () => ({ listAvailableProjectRepos: jest.fn().mockResolvedValue([]) }));
jest.mock('../useChatResourceProject', () => ({ useChatResourceProject: () => ({ loading: false }) }));
jest.mock('@/layout/sider/components/ActiveSiderAgentBar', () => ({ useActiveSiderAgent: () => ({}) }));
jest.mock('@/utils/agent', () => ({ getAgentChatAvatar: jest.fn() }));
jest.mock('@/layout/sider/components/Knowledge', () => () => null);
jest.mock('@/layout/sider/components/ModelSiderPanel', () => () => null);
jest.mock('@/layout/sider/components/ResourceSiderPanel', () => () => null);
jest.mock('@/layout/sider/components/ProjectSpaceList/CodesTab', () => () => null);
jest.mock('../FileResourcePanel', () => () => <div>files</div>);
jest.mock('@/components/ProjectDataSources', () => () => <div>datasource content</div>);

const query = jest.mocked(querySessionDataSources);
const page = (total: number) => ({ items: [], total, pageNum: 1, pageSize: 50 });
const panel = (sessionId = 'session-1') => (
  <ResourcePanel sessionId={sessionId} projectId={1} onOpenDetail={jest.fn()} />
);

beforeEach(() => jest.clearAllMocks());

it('hides the project data tab when the session has no data', async () => {
  query.mockResolvedValue(page(0));
  await act(async () => {
    render(panel());
  });
  expect(query).toHaveBeenCalledWith('session-1');
  expect(screen.queryByRole('tab', { name: 'dataSource.title' })).not.toBeInTheDocument();
});

it('shows the tab with data and falls back to files when refresh returns no data', async () => {
  query.mockResolvedValueOnce(page(1)).mockResolvedValueOnce(page(0));
  render(panel());
  fireEvent.click(await screen.findByRole('tab', { name: 'dataSource.title' }));
  expect(screen.getByText('datasource content')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'common.refresh' }));
  await waitFor(() => expect(screen.queryByRole('tab', { name: 'dataSource.title' })).not.toBeInTheDocument());
  expect(screen.getByText('files')).toBeInTheDocument();
});

it('ignores a late response from the previous session', async () => {
  let resolvePrevious!: (value: ReturnType<typeof page>) => void;
  query.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolvePrevious = resolve;
      })
  );
  query.mockResolvedValueOnce(page(0));
  const view = render(panel());
  await act(async () => {
    view.rerender(panel('session-2'));
  });
  await act(async () => {
    resolvePrevious(page(1));
  });
  expect(screen.queryByRole('tab', { name: 'dataSource.title' })).not.toBeInTheDocument();
});

it('hides the tab when the availability query fails', async () => {
  query.mockRejectedValue(new Error('failed'));
  await act(async () => {
    render(panel());
  });
  expect(screen.queryByRole('tab', { name: 'dataSource.title' })).not.toBeInTheDocument();
});
