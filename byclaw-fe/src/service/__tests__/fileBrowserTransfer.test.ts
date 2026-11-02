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

it('propagates a capability failure without falling back to the legacy upload', async () => {
  const { GET } = await import('@/service/common/request');
  const { uploadFiles } = await import('@/service/fileBrowser');
  const file = new File(['x'], 'large.bin');
  Object.defineProperty(file, 'size', { value: 9 * 1024 * 1024 });
  (GET as jest.Mock).mockRejectedValue(new Error('platform offline'));
  await expect(uploadFiles('10', '/by/', [file], undefined, undefined, { ownerKey: 'Alice' })).rejects.toThrow(
    'platform offline'
  );
  expect(POST).not.toHaveBeenCalled();
});

it('sends large files through durable sessions when the capability is available', async () => {
  const { GET } = await import('@/service/common/request');
  const { uploadFiles } = await import('@/service/fileBrowser');
  const file = new File([new Uint8Array(9 * 1024 * 1024)], 'large.bin');
  (GET as jest.Mock).mockResolvedValue({ resumable: true, maxSize: 4294967296 });
  (POST as jest.Mock).mockImplementation(async (url, body) => {
    if (url.endsWith('/create'))
      return {
        uploadId: body.uploadId,
        totalSize: file.size,
        chunkSize: 4194304,
        totalChunks: 3,
        uploadedChunks: [],
        state: 'COMPLETED',
      };
  });
  await uploadFiles('10', '/by/', [file], undefined, undefined, { ownerKey: 'Alice', overwrite: true });
  expect(POST).toHaveBeenCalledWith(
    '/byaiService/fileBrowser/uploads/create',
    expect.objectContaining({
      resourceId: '10',
      path: '/by/',
      fileName: 'large.bin',
      overwrite: true,
      totalSize: file.size,
    }),
    expect.anything()
  );
  expect(POST).not.toHaveBeenCalledWith('/byaiService/fileBrowser/upload', expect.anything(), expect.anything());
});

it('does not interpret an invalid capability envelope as permission to change upload route', async () => {
  const { GET } = await import('@/service/common/request');
  const { uploadFiles } = await import('@/service/fileBrowser');
  const file = new File(['x'], 'large.bin');
  Object.defineProperty(file, 'size', { value: 9 * 1024 * 1024 });
  (GET as jest.Mock).mockResolvedValue(undefined);
  await expect(uploadFiles('10', '/by/', [file], undefined, undefined, { ownerKey: 'Alice' })).rejects.toThrow(
    'Invalid file transfer capability response'
  );
  expect(POST).not.toHaveBeenCalled();
});

it('rejects files beyond the advertised platform limit before reading contents or creating a session', async () => {
  const { GET } = await import('@/service/common/request');
  const { uploadFiles } = await import('@/service/fileBrowser');
  const file = new File(['x'], 'too-large.bin');
  Object.defineProperty(file, 'size', { value: 4294967297 });
  const read = jest.spyOn(file, 'slice');
  (GET as jest.Mock).mockResolvedValue({ resumable: true, maxSize: 4294967296 });
  await expect(uploadFiles('10', '/by/', [file], undefined, undefined, { ownerKey: 'Alice' })).rejects.toThrow(
    '4096 MiB'
  );
  expect(read).not.toHaveBeenCalled();
  expect(POST).not.toHaveBeenCalled();
});

it('does not read or upload after capabilities return into another task context', async () => {
  const { GET } = await import('@/service/common/request');
  const { uploadFiles } = await import('@/service/fileBrowser');
  const file = new File(['x'], 'context-file.bin');
  Object.defineProperty(file, 'size', { value: 9 * 1024 * 1024 });
  const read = jest.spyOn(file, 'slice');
  let current = true;
  (GET as jest.Mock).mockImplementation(async () => {
    current = false;
    return { resumable: true, maxSize: 4294967296 };
  });
  await expect(
    uploadFiles('old-employee', '/by/', [file], undefined, undefined, {
      ownerKey: 'old-actor',
      checkContext: () => {
        if (!current) throw new Error('context changed');
      },
    })
  ).rejects.toThrow('context changed');
  expect(read).not.toHaveBeenCalled();
  expect(POST).not.toHaveBeenCalled();
});
