import { POST } from '@/service/common/request';
import {
  openPublication,
  publicationEntryLabel,
  publicationStatus,
  saveOfficialUpdateDraft,
} from './employeePublication';

let mockLocale: 'zh-CN' | 'en-US' = 'zh-CN';
jest.mock('@/service/common/request', () => ({ POST: jest.fn(), GET: jest.fn() }));
jest.mock('@umijs/max', () => ({
  history: { push: jest.fn() },
  getIntl: () => require('@/testUtils/localeIntl').getLocaleIntl(mockLocale),
}));
const base = '/byaiService/digitalEmployeePublication';
const candidate = (status = 'DRAFT', revision = 1) => ({
  publication: { requestId: '100', officialId: '20', status, revision },
  canEdit: true,
  canRevise: ['REJECTED', 'WITHDRAWN'].includes(status),
});
beforeEach(() => {
  mockLocale = 'zh-CN';
  jest.resetAllMocks();
});
it('labels a new employee publication as publishing to enterprise', () => {
  expect(publicationEntryLabel()).toBe('发布到企业');
});
it('opens a publication page through the draft synchronization endpoint and returns the latest resource configuration', async () => {
  const fresh = { ...candidate(), employee: { relIds: ['21'] }, sourceResourcesChanged: true };
  (POST as jest.Mock).mockResolvedValue(fresh);
  await expect(openPublication('100')).resolves.toBe(fresh);
  expect(POST).toHaveBeenCalledWith(`${base}/open`, { requestId: '100' });
});
it('saves B configuration as a candidate without mutating the live employee', async () => {
  (POST as jest.Mock).mockResolvedValue(candidate());
  const employee = { resourceName: 'B updated', resourceId: '20' };
  await saveOfficialUpdateDraft('20', employee);
  expect(POST).toHaveBeenNthCalledWith(1, `${base}/prepare`, { resourceId: '20' });
  expect(POST).toHaveBeenNthCalledWith(2, `${base}/save`, { requestId: '100', revision: 1, employee });
  expect(POST).toHaveBeenCalledTimes(2);
});
it.each(['PENDING', 'APPLYING', 'FAILED'])('does not overwrite an outstanding %s application', async (status) => {
  (POST as jest.Mock).mockResolvedValue(candidate(status));
  await expect(saveOfficialUpdateDraft('20', {})).rejects.toThrow(
    '该员工已有未完成的更新申请，请先在审批中心处理或撤回申请后再保存'
  );
  expect(POST).toHaveBeenCalledTimes(1);
});
it.each(['REJECTED', 'WITHDRAWN'])('creates a successor for %s and saves using its revision', async (status) => {
  (POST as jest.Mock)
    .mockResolvedValueOnce(candidate(status))
    .mockResolvedValueOnce({
      ...candidate(),
      publication: { ...candidate().publication, requestId: '101', revision: 3 },
    })
    .mockResolvedValue(candidate());
  await saveOfficialUpdateDraft('20', {});
  expect(POST).toHaveBeenNthCalledWith(2, `${base}/revise`, { requestId: '100', revision: 1 });
  expect(POST).toHaveBeenNthCalledWith(3, `${base}/save`, { requestId: '101', revision: 3, employee: {} });
});
it('refuses a candidate belonging to a different official employee', async () => {
  (POST as jest.Mock).mockResolvedValue(candidate());
  await expect(saveOfficialUpdateDraft('30', {})).rejects.toThrow('官方副本已变化');
  expect(POST).toHaveBeenCalledTimes(1);
});

it('resolves status and entry labels from the current language on every access', () => {
  expect(publicationStatus.PENDING).toBe('待审核');
  expect(publicationEntryLabel('DRAFT', true)).toBe('继续发布更新');
  mockLocale = 'en-US';
  expect(publicationStatus.PENDING).toBe('Pending review');
  expect(publicationEntryLabel('DRAFT', true)).toBe('Continue publication update');
  expect(publicationEntryLabel('PUBLISHED')).toBe('Publish update');
  expect(publicationEntryLabel()).toBe('Publish to enterprise');
});
