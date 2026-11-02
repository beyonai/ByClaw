import { downloadResourceFileForPreview } from './file';
import { GET } from '@/service/common/request';

jest.mock('@umijs/max', () => ({ getLocale: () => 'en-US' }));
jest.mock('@/service/common/request', () => ({ GET: jest.fn(), POST: jest.fn() }));
jest.mock('@/service/common/desktopLocal', () => ({ hasDesktopLocalFiles: jest.fn() }));

it('uses the current preview language and respects explicit overrides without changing the resource ID', () => {
  const resourceId = '9007199254740993';
  downloadResourceFileForPreview({ resourceId, directoryPath: 'report.pdf' });
  expect(GET).toHaveBeenLastCalledWith(
    '/byaiService/datasetController/download',
    expect.objectContaining({ resourceId, language: 'en-US' }),
    { responseType: 'blob' }
  );
  downloadResourceFileForPreview({ resourceId, directoryPath: '/', language: 'zh-CN' });
  expect(GET).toHaveBeenLastCalledWith(
    '/byaiService/datasetController/download',
    expect.objectContaining({ resourceId, language: 'zh-CN', directoryPath: '/' }),
    { responseType: 'blob' }
  );
});
