import { POST } from '@/service/common/request';
import { uploadResumableFile, fingerprintFile, hasAdmittedUpload } from '@/service/resumableFileUpload';

jest.mock('@/service/common/request', () => ({ GET: jest.fn(), POST: jest.fn() }));

const makeFile = (contents: string) => new File([contents], 'same.bin', { lastModified: 100 });
const status = {
  uploadId: 'upload-1',
  chunkSize: 4,
  totalSize: 8,
  totalChunks: 2,
  uploadedChunks: [0],
  state: 'UPLOADING',
};
beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
});

it('hashes contents so same name size and timestamp cannot resume different bytes', async () => {
  expect(await fingerprintFile(makeFile('aaaaaaaa'))).not.toBe(await fingerprintFile(makeFile('bbbbbbbb')));
});

it('resumes only missing chunks and combines acknowledged and in-flight progress', async () => {
  (POST as jest.Mock).mockImplementation(async (url, body, config) => {
    if (url.endsWith('/create')) return status;
    if (url.endsWith('/chunk')) {
      config.onUploadProgress({ loaded: 2, total: 4 });
      return { ...status, uploadedChunks: [0, 1] };
    }
    return { ...status, state: 'COMPLETED' };
  });
  const progress: number[] = [];
  await uploadResumableFile('10', '/by/', makeFile('abcdefgh'), 'Alice', (e) => progress.push(e.loaded));
  const chunks = (POST as jest.Mock).mock.calls.filter(([url]) => url.endsWith('/chunk'));
  expect(chunks).toHaveLength(1);
  expect(chunks[0][1].get('index')).toBe('1');
  expect(progress).toEqual(expect.arrayContaining([4, 6, 8]));
  expect(localStorage.length).toBe(0);
});

it('retains upload identity after failure and reuses it after reselecting the same content', async () => {
  (POST as jest.Mock).mockImplementation(async (url) => {
    if (url.endsWith('/create')) return { ...status, uploadedChunks: [] };
    throw new Error('network');
  });
  await expect(uploadResumableFile('10', '/by/', makeFile('abcdefgh'), 'Alice')).rejects.toThrow('network');
  const firstId = (POST as jest.Mock).mock.calls[0][1].uploadId;
  expect(localStorage.length).toBe(1);
  await expect(uploadResumableFile('10', '/by/', makeFile('abcdefgh'), 'Alice')).rejects.toThrow('network');
  const creates = (POST as jest.Mock).mock.calls.filter(([url]) => url.endsWith('/create'));
  expect(creates[1][1].uploadId).toBe(firstId);
});

it('creates a new upload identity after an explicit expired session response', async () => {
  let creates = 0;
  (POST as jest.Mock).mockImplementation(async (url) => {
    if (url.endsWith('/create')) {
      creates += 1;
      if (creates === 1) return { state: 'EXPIRED' };
      return { ...status, state: 'COMPLETED' };
    }
  });
  await uploadResumableFile('10', '/by/', makeFile('abcdefgh'), 'Alice');
  const requests = (POST as jest.Mock).mock.calls.filter(([url]) => url.endsWith('/create'));
  expect(requests).toHaveLength(2);
  expect(requests[0][1].uploadId).not.toBe(requests[1][1].uploadId);
  expect(localStorage.length).toBe(0);
});

it('never sends another owner or different file content into a stored upload session', async () => {
  (POST as jest.Mock).mockImplementation(async (url) => {
    if (url.endsWith('/create')) throw new Error('offline');
  });
  await expect(uploadResumableFile('10', '/by/', makeFile('abcdefgh'), 'Alice')).rejects.toThrow();
  await expect(uploadResumableFile('10', '/by/', makeFile('abcdefgh'), 'Bob')).rejects.toThrow();
  await expect(uploadResumableFile('10', '/by/', makeFile('12345678'), 'Alice')).rejects.toThrow();
  const requests = (POST as jest.Mock).mock.calls.filter(([url]) => url.endsWith('/create'));
  expect(new Set(requests.map((call) => call[1].uploadId)).size).toBe(3);
});

it('continues an admitted upload using its original chunk layout after the current maximum is lowered', async () => {
  const file = makeFile('abcdefgh');
  (POST as jest.Mock).mockImplementation(async (url) => {
    if (url.endsWith('/create')) return { ...status, uploadedChunks: [] };
    throw new Error('offline');
  });
  await expect(uploadResumableFile('policy-user', '/by/policy/', file, 'policy-owner')).rejects.toThrow('offline');
  const id = (POST as jest.Mock).mock.calls.find(([url]) => url.endsWith('/create'))![1].uploadId;
  (POST as jest.Mock).mockImplementation(async (url) => {
    if (url.endsWith('/create')) return { ...status, uploadedChunks: [0] };
    return { ...status, state: 'COMPLETED' };
  });
  await uploadResumableFile('policy-user', '/by/policy/', makeFile('abcdefgh'), 'policy-owner', undefined, false, 4);
  const creates = (POST as jest.Mock).mock.calls.filter(([url]) => url.endsWith('/create'));
  expect(creates[1][1].uploadId).toBe(id);
});

it('keeps hashing in bounded blocks while accepting a configured8MiB upload chunk', async () => {
  const file = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'config-chunk.bin');
  const slice = jest.spyOn(file, 'slice');
  const session = {
    uploadId: 'large-chunk',
    chunkSize: 8 * 1024 * 1024,
    totalSize: file.size,
    totalChunks: 2,
    uploadedChunks: [0],
    state: 'UPLOADING',
  };
  (POST as jest.Mock).mockImplementation(async (url) => {
    if (url.endsWith('/create')) return session;
    return { ...session, state: 'COMPLETED' };
  });
  await uploadResumableFile('1', '/by/', file, 'owner8');
  expect(slice.mock.calls.slice(0, 3).map(([start, end]) => Number(end) - Number(start))).toEqual([
    4194304, 4194304, 1,
  ]);
  const chunk = (POST as jest.Mock).mock.calls.find(([url]) => url.endsWith('/chunk'))![1];
  expect(chunk.get('index')).toBe('1');
  expect(chunk.get('chunk').size).toBe(1);
});

it('uses server status for an old-policy candidate but still rejects different content under a lower new policy', async () => {
  const file = makeFile('abcdefgh');
  const hash = await fingerprintFile(file);
  (POST as jest.Mock).mockImplementation(async (url) => {
    if (url.endsWith('/create')) return { ...status, uploadedChunks: [] };
    throw new Error('interrupted');
  });
  await expect(uploadResumableFile('candidate', '/by/policy/', file, 'candidate-owner')).rejects.toThrow();
  (POST as jest.Mock).mockImplementation(async (url) => {
    if (url.endsWith('/status')) return { ...status, sha256: hash, maxSize: 8 };
    return { ...status, state: 'COMPLETED' };
  });
  expect(await hasAdmittedUpload('candidate', '/by/policy/', makeFile('different'), 'candidate-owner')).toBe(false);
  expect(await hasAdmittedUpload('candidate', '/by/policy/', makeFile('12345678'), 'candidate-owner')).toBe(true);
  const before = (POST as jest.Mock).mock.calls.filter(([url]) => url.endsWith('/create')).length;
  await expect(
    uploadResumableFile('candidate', '/by/policy/', makeFile('12345678'), 'candidate-owner', undefined, false, 4)
  ).rejects.toThrow('maximum upload size');
  expect((POST as jest.Mock).mock.calls.filter(([url]) => url.endsWith('/create'))).toHaveLength(before);
});

it('cannot create a session after hashing completed under a stale task context', async () => {
  let current = true;
  const checkContext = () => {
    if (!current) throw new Error('context changed');
  };
  (POST as jest.Mock).mockResolvedValue({ ...status, state: 'COMPLETED' });
  await expect(
    uploadResumableFile(
      '10',
      '/by/',
      makeFile('abcdefgh'),
      'old-actor',
      (progress) => {
        if (progress.phase === 'hashing' && progress.loaded === 8) current = false;
      },
      false,
      100,
      checkContext
    )
  ).rejects.toThrow('context changed');
  expect(POST).not.toHaveBeenCalled();
});

it('cannot send a later chunk after its create request returns into a different context', async () => {
  let current = true;
  const checkContext = () => {
    if (!current) throw new Error('context changed');
  };
  (POST as jest.Mock).mockImplementation(async (url) => {
    if (url.endsWith('/create')) {
      current = false;
      return { ...status, uploadedChunks: [] };
    }
    return { ...status, state: 'COMPLETED' };
  });
  await expect(
    uploadResumableFile('10', '/by/', makeFile('abcdefgh'), 'old-actor', undefined, false, 100, checkContext)
  ).rejects.toThrow('context changed');
  expect((POST as jest.Mock).mock.calls.length).toBe(1);
});

it('only inspects current-owner stored sessions and forgets them after acknowledged abort', async () => {
  const { listStoredUploads, abortStoredUpload } = await import('@/service/resumableFileUpload');
  const key = (owner: string) =>
    `byclaw-upload:${JSON.stringify([owner, '10', '/by/test/', 'old.bin', 8, 'a'.repeat(64), false])}`;
  localStorage.setItem(key('session-manager-owner'), 'a21a7ce9-2c36-4cc0-9b8c-65aa684710ab');
  localStorage.setItem(key('another-owner'), 'c21a7ce9-2c36-4cc0-9b8c-65aa684710ab');
  (POST as jest.Mock).mockResolvedValue({ ...status, totalSize: 8, sha256: 'a'.repeat(64) });
  const rows = await listStoredUploads('session-manager-owner');
  expect(rows).toHaveLength(1);
  expect(rows[0].fileName).toBe('old.bin');
  (POST as jest.Mock).mockResolvedValue({ state: 'UPLOADING' });
  await expect(abortStoredUpload('session-manager-owner', rows[0])).rejects.toThrow();
  expect(localStorage.getItem(key('session-manager-owner'))).not.toBeNull();
  (POST as jest.Mock).mockResolvedValue({ state: 'EXPIRED' });
  await abortStoredUpload('session-manager-owner', rows[0]);
  expect(localStorage.getItem(key('session-manager-owner'))).toBeNull();
  expect(localStorage.getItem(key('another-owner'))).not.toBeNull();
  await expect(abortStoredUpload('another-owner', rows[0])).rejects.toThrow();
});

it('rebuilds cancellation targets from browser storage and rejects unknown server identities', async () => {
  const { listStoredUploads, abortStoredUpload } = await import('@/service/resumableFileUpload');
  const owner = 'cancel-identity-owner';
  const storageKey = `byclaw-upload:${JSON.stringify([
    owner,
    '10',
    '/by/test/',
    'known.bin',
    8,
    'a'.repeat(64),
    false,
  ])}`;
  localStorage.setItem(storageKey, 'a21a7ce9-2c36-4cc0-9b8c-65aa684710ab');
  (POST as jest.Mock).mockResolvedValue({ ...status, sha256: 'a'.repeat(64) });
  const [row] = await listStoredUploads(owner);
  (POST as jest.Mock).mockClear();
  (POST as jest.Mock).mockResolvedValue({ ...status, sha256: 'b'.repeat(64) });
  await expect(abortStoredUpload(owner, row)).rejects.toThrow('identity mismatch');
  expect((POST as jest.Mock).mock.calls.every(([url]) => url.endsWith('/status'))).toBe(true);
  (POST as jest.Mock).mockClear();
  (POST as jest.Mock).mockResolvedValue({ state: 'UNKNOWN' });
  await expect(abortStoredUpload(owner, row)).rejects.toThrow('Invalid stored upload status');
  expect((POST as jest.Mock).mock.calls).toHaveLength(1);
  (POST as jest.Mock).mockClear();
  (POST as jest.Mock).mockImplementation(async (url) =>
    url.endsWith('/status') ? { ...status, sha256: 'a'.repeat(64) } : { state: 'EXPIRED' }
  );
  await abortStoredUpload(owner, { ...row, resourceId: 'other', path: '/unknown/', fileName: 'unknown.bin' });
  expect((POST as jest.Mock).mock.calls[1][1]).toEqual({
    resourceId: '10',
    path: '/by/test/',
    fileName: 'known.bin',
    uploadId: row.uploadId,
  });
  expect(localStorage.getItem(storageKey)).toBeNull();
});

it('recovers authorized server-only sessions and verifies status before explicit cancellation', async () => {
  const { listStoredUploads, abortStoredUpload } = await import('@/service/resumableFileUpload');
  const item = {
    uploadId: 'd21a7ce9-2c36-4cc0-9b8c-65aa684710ab',
    path: '/by/old/',
    fileName: 'server.bin',
    totalSize: 12,
    state: 'UPLOADING',
  };
  (POST as jest.Mock).mockImplementation(async (url) => {
    if (url.endsWith('/list')) return { uploads: [item] };
    if (url.endsWith('/status')) return { ...item, sha256: 'server-secret-hash' };
    return { state: 'EXPIRED' };
  });
  const [row] = await listStoredUploads('server-only-owner', '42');
  expect(row.source).toBe('server');
  expect(row.sha256).toBeUndefined();
  expect((POST as jest.Mock).mock.calls.some(([url]) => url.endsWith('/abort'))).toBe(false);
  (POST as jest.Mock).mockClear();
  (POST as jest.Mock).mockResolvedValue({ ...item, totalSize: 99 });
  await expect(abortStoredUpload('server-only-owner', row)).rejects.toThrow('identity mismatch');
  expect((POST as jest.Mock).mock.calls).toHaveLength(1);
  (POST as jest.Mock).mockImplementation(async (url) => (url.endsWith('/status') ? item : { state: 'EXPIRED' }));
  await abortStoredUpload('server-only-owner', { ...row, path: '/unknown/' });
  expect((POST as jest.Mock).mock.calls.slice(-1)[0][1]).toEqual({
    resourceId: '42',
    path: '/by/old/',
    fileName: 'server.bin',
    uploadId: item.uploadId,
  });
  await expect(abortStoredUpload('another-owner', row)).rejects.toThrow();
});

it.each(['alice:43', 'bob:42'])(
  'does not abort or forget a saved upload after status returns into %s',
  async (nextContext) => {
    const { listStoredUploads, abortStoredUpload } = await import('@/service/resumableFileUpload');
    const owner = `context-race-${nextContext}`;
    const storageKey = `byclaw-upload:${JSON.stringify([
      owner,
      '42',
      '/by/test/',
      'race.bin',
      8,
      'a'.repeat(64),
      false,
    ])}`;
    localStorage.setItem(storageKey, 'e21a7ce9-2c36-4cc0-9b8c-65aa684710ab');
    (POST as jest.Mock).mockResolvedValue({ ...status, sha256: 'a'.repeat(64) });
    const [row] = await listStoredUploads(owner);
    let resolveStatus!: (value: object) => void;
    (POST as jest.Mock).mockClear();
    (POST as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        })
    );
    let context = 'alice:42';
    const cancellation = abortStoredUpload(owner, row, () => {
      if (context !== 'alice:42') throw new Error('context changed');
    });
    context = nextContext;
    resolveStatus({ ...status, sha256: 'a'.repeat(64) });
    await expect(cancellation).rejects.toThrow('context changed');
    expect((POST as jest.Mock).mock.calls).toHaveLength(1);
    expect(localStorage.getItem(storageKey)).not.toBeNull();
  }
);
