import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProjectDataSources from '../index';
import {
  listDataSources,
  querySessionDataSources,
  saveDataSource,
  changeDataSourceBinding,
} from '@/service/projectDataSources';

const mockEmit = jest.fn();
const mockIntl = { formatMessage: ({ id }: { id: string }) => id };
jest.mock('@umijs/max', () => ({ useIntl: () => mockIntl }));
jest.mock('@/hooks/useGlobal', () => () => ({ EventEmitter: { emit: mockEmit } }));
jest.mock('@/service/projectDataSources', () => ({
  listDataSources: jest.fn(),
  querySessionDataSources: jest.fn(),
  availableDataSources: jest.fn(),
  saveDataSource: jest.fn(),
  changeDataSourceBinding: jest.fn(),
}));
const source = {
  datasourceId: '17',
  datasourceName: 'Analytics',
  datasourceType: 'opengauss',
  connectionConfig: { host: 'private-host' },
  hasPassword: true,
  canEdit: true,
  canManageBinding: true,
};

describe('ProjectDataSources', () => {
  beforeEach(() => jest.clearAllMocks());

  it('emits only an identifier and name on double click, and keeps session management read-only', async () => {
    jest.mocked(querySessionDataSources).mockResolvedValue({ items: [source], total: 1, pageNum: 1, pageSize: 50 });
    render(<ProjectDataSources sessionId="session-1" />);
    fireEvent.doubleClick(await screen.findByText('Analytics'));
    expect(mockEmit).toHaveBeenCalledWith('queryInput-insert-item', {
      type: 'DATA_SOURCE',
      item: { resourceId: '17', resourceName: 'Analytics' },
    });
    expect(screen.queryByRole('button', { name: 'dataSource.create' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'dataSource.bind' })).toBeNull();
    expect(JSON.stringify(mockEmit.mock.calls)).not.toContain('private-host');
  });

  it('discards results from the previous project after switching', async () => {
    let resolveOld: (items: (typeof source)[]) => void = () => undefined;
    jest.mocked(listDataSources).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        })
    );
    jest.mocked(listDataSources).mockResolvedValueOnce([{ ...source, datasourceName: 'Current source' }]);
    const view = render(<ProjectDataSources projectId={1} />);
    view.rerender(<ProjectDataSources projectId={2} />);
    await screen.findByText('Current source');
    await act(async () => resolveOld([source]));
    expect(screen.queryByText('Analytics')).toBeNull();
    expect(screen.getByText('Current source')).toBeTruthy();
  });

  it('edits a linked source without resending an existing password', async () => {
    jest.mocked(listDataSources).mockResolvedValue([
      {
        ...source,
        connectionConfig: { host: 'db', port: '5432', database: 'analytics', username: 'reader', sslMode: 'require' },
      },
    ]);
    jest.mocked(saveDataSource).mockResolvedValue(source);
    render(<ProjectDataSources projectId={1} canManage />);
    await screen.findByText('Analytics');
    fireEvent.click(screen.getByRole('button', { name: 'dataSource.actions' }));
    fireEvent.click(await screen.findByText('dataSource.edit'));
    fireEvent.change(screen.getByLabelText('dataSource.name'), { target: { value: 'Updated analytics' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() =>
      expect(saveDataSource).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ datasourceName: 'Updated analytics', password: undefined }),
        '17'
      )
    );
  });

  it('unlinks only the project binding after confirmation', async () => {
    jest.mocked(listDataSources).mockResolvedValue([source]);
    jest.mocked(changeDataSourceBinding).mockResolvedValue(undefined);
    render(<ProjectDataSources projectId={1} canManage />);
    await screen.findByText('Analytics');
    fireEvent.click(screen.getByRole('button', { name: 'dataSource.actions' }));
    fireEvent.click(await screen.findByText('dataSource.unbind'));
    await screen.findByText('dataSource.unlinkWarning');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(changeDataSourceBinding).toHaveBeenCalledWith('unbind', 1, '17'));
  });

  it('renders management actions in the supplied card header before maximize', async () => {
    jest.mocked(listDataSources).mockResolvedValue([]);
    render(
      <ProjectDataSources
        projectId={1}
        canManage
        renderHeader={(actions) => (
          <header aria-label="resource header">
            {actions}
            <button>maximize</button>
          </header>
        )}
      />
    );
    const header = screen.getByRole('banner', { name: 'resource header' });
    const buttons = within(header).getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label') || button.textContent)).toEqual([
      'dataSource.create',
      'dataSource.bind',
      'maximize',
    ]);
    fireEvent.click(buttons[0]);
    expect(await screen.findByLabelText('dataSource.name')).toBeTruthy();
    expect(screen.getByText('dataSource.connectionInfo')).toBeTruthy();
  });

  it('shows project binding controls only to project managers', async () => {
    jest.mocked(listDataSources).mockResolvedValue([]);
    const view = render(<ProjectDataSources projectId={1} />);
    await waitFor(() => expect(listDataSources).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'dataSource.create' })).toBeNull();
    view.rerender(<ProjectDataSources projectId={1} canManage />);
    expect(screen.getByRole('button', { name: 'dataSource.create' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'dataSource.bind' })).toBeTruthy();
  });
});
