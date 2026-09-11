import { POST } from '@/service/common/request';
import { querySessionDataSources, saveDataSource, changeDataSourceBinding } from '@/service/projectDataSources';

jest.mock('@/service/common/request', () => ({ POST: jest.fn() }));

it('normalizes FastJson pagination strings at the API boundary', async () => {
  jest.mocked(POST).mockResolvedValue({ items: [], total: '101', pageNum: '2', pageSize: '50' });
  await expect(querySessionDataSources('session-1', 2)).resolves.toEqual({
    items: [],
    total: 101,
    pageNum: 2,
    pageSize: 50,
  });
  expect(POST).toHaveBeenCalledWith('/byaiService/api/v1/sessionResources/query', {
    sessionId: 'session-1',
    resourceType: 'data_source',
    pageNum: 2,
    pageSize: 50,
  });
});

it('sends consistent datasource fields for saving and linking', async () => {
  const input = { datasourceName: '报表库', datasourceType: 'opengauss', connectionConfig: { host: 'db' } };
  jest.mocked(POST).mockResolvedValue({ datasourceId: '17', ...input });
  await saveDataSource(1, input, '17');
  expect(POST).toHaveBeenLastCalledWith('/byaiService/api/v1/projectDataSources/update', {
    projectId: 1,
    datasourceId: '17',
    ...input,
  });
  await changeDataSourceBinding('bind', 1, '17');
  expect(POST).toHaveBeenLastCalledWith('/byaiService/api/v1/projectDataSources/bind', {
    projectId: 1,
    datasourceId: '17',
  });
});
