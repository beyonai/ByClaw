import { POST } from '@/service/common/request';
import { ensureFolder, listFiles, saveToPersonalKnowledge } from '@/service/fileBrowser';

jest.mock('@/service/common/request', () => ({ POST: jest.fn(), GET: jest.fn() }));
jest.mock('@/service/common/desktopLocal', () => ({ hasDesktopLocalFiles: () => false }));

beforeEach(() => jest.clearAllMocks());

it('lets the shared directory dialog own its initialization error', () => {
  const params = { resourceId: '10', path: '/by/.shared/' };
  ensureFolder(params, { hideErrorTips: true });
  expect(POST).toHaveBeenCalledWith('/byaiService/fileBrowser/ensureFolder', params, {
    responseCfg: { hideErrorTips: true },
  });
  listFiles(params, { hideErrorTips: true });
  expect(POST).toHaveBeenLastCalledWith('/byaiService/fileBrowser/list', params, {
    responseCfg: { hideErrorTips: true },
  });
});

it('keeps personal knowledge upload failures in the save dialog', () => {
  const params = {
    resourceId: '10',
    sourcePath: '/by/.sessions/1/random_hello.txt',
    sourceDir: false,
    targetResourceId: '20',
    targetDirectoryPath: '/',
    buildAfterSave: true,
  };
  saveToPersonalKnowledge(params);
  expect(POST).toHaveBeenCalledWith('/byaiService/fileBrowser/saveToPersonalKnowledge', params, {
    responseCfg: { hideErrorTips: true },
  });
});
