import { buildFileRemoteProxy } from '../buildFileRemoteProxy';

describe('file remote development proxy', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      FILE_STORAGE_TYPE: 'file',
      BYCLAW_REMOTE_BE_HOST: 'files.example.test',
      BE_SERVER_PORT: '8086',
    };
    delete process.env.BE_HOST;
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it.each([undefined, 'localhost', '127.0.0.1'])('does not override a remote target when BE_HOST is %s', (beHost) => {
    if (beHost !== undefined) {
      process.env.BE_HOST = beHost;
    }

    expect(buildFileRemoteProxy('/', 'https://online.example.test')).toEqual({});
  });

  it.each(['http://localhost:8086', 'http://127.0.0.1:8086'])('routes file access remotely for %s', (target) => {
    process.env.BE_HOST = 'stale.example.test';
    const proxy = buildFileRemoteProxy('/beyond/', target);

    expect(proxy['/beyond/byaiService/fileBrowser']).toEqual({
      target: 'http://files.example.test:8086',
      changeOrigin: true,
    });
    expect(Object.keys(proxy)).toEqual([
      '/beyond/byaiService/fileBrowser',
      '/beyond/byaiService/devloop/task/changes',
      '/beyond/byaiService/devloop/task/file-diff',
      '/beyond/byaiService/commonFile/download',
    ]);
  });

  it('keeps non-file storage on the main target', () => {
    process.env.FILE_STORAGE_TYPE = 'minio';

    expect(buildFileRemoteProxy('/', 'http://localhost:8086')).toEqual({});
  });

  it.each(['', 'localhost', '127.0.0.1'])('does not enable a remote override for remote host %s', (remoteHost) => {
    process.env.BYCLAW_REMOTE_BE_HOST = remoteHost;

    expect(buildFileRemoteProxy('/', 'http://localhost:8086')).toEqual({});
  });
});
