import { getRecorderClient, resetRecorderClient } from './recorderClient';
import { buildRecorderEndpoint, createHttpRecorderClient } from './byclawRecorderClient';
import { GET, POST } from '@/service/common/request';

jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
  POST: jest.fn(),
}));

describe('adapter recorder client selection', () => {
  afterEach(() => {
    resetRecorderClient();
    jest.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('uses the byclaw recorder HTTP client by default', async () => {
    (GET as jest.Mock).mockResolvedValue({
      ok: true,
      schemaVersion: 'recorder.v1',
      requestId: 'req_test',
      data: { localService: 'ok', daemon: 'down', extension: 'disconnected', highLevel: 'down' },
      error: null,
    });

    const client = getRecorderClient();
    const res = await client.health();

    expect(res.ok).toBe(true);
    expect(res.data?.localService).toBe('ok');
    expect(GET).toHaveBeenCalledWith(
      '/byaiService/recorder/health',
      {},
      expect.objectContaining({
        headers: { 'X-Byclaw-Recorder': '1' },
      })
    );
  });

  it('reserves byclaw recorder endpoints behind /byaiService', () => {
    expect(buildRecorderEndpoint(undefined, '/recorder/health')).toBe('/byaiService/recorder/health');
    expect(buildRecorderEndpoint('/byaiService/recorder', '/recorder/session/bind')).toBe(
      '/byaiService/recorder/session/bind'
    );
  });

  it('does not expose a score prompt from local rank results', async () => {
    (POST as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        schemaVersion: 'recorder.v1',
        requestId: 'bind_req',
        data: { sessionId: 'session_1', contextId: 'ctx', targetId: 'target', awaitingLogin: false },
        error: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        schemaVersion: 'recorder.v1',
        requestId: 'rank_req',
        data: {
          candidates: [
            {
              id: 'cand_search',
              endpoint: { method: 'GET', host: 'api.example.test', pathname: '/search' },
              score: 90,
              confidence: 'high',
              reviewRequired: false,
            },
          ],
          scorePrompt: 'obsolete rank prompt',
        },
        error: null,
      });

    const client = createHttpRecorderClient({ enabled: true, baseUrl: '/byaiService/recorder' });
    await client.bind('existing');
    const result = await client.rank();

    expect(result.data).toEqual({
      candidates: [
        {
          id: 'cand_search',
          endpoint: { method: 'GET', host: 'api.example.test', pathname: '/search' },
          score: 90,
          confidence: 'high',
          reviewRequired: false,
        },
      ],
    });
  });

  it('verifies the current editor source and preserves terminal verification metadata', async () => {
    (POST as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        schemaVersion: 'recorder.v1',
        requestId: 'bind_req',
        data: { sessionId: 'session_1', contextId: 'ctx', targetId: 'target', awaitingLogin: false },
        error: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        schemaVersion: 'recorder.v1',
        requestId: 'verify_req',
        data: null,
        error: null,
      });
    (GET as jest.Mock).mockResolvedValueOnce({
      ok: true,
      schemaVersion: 'recorder.v1',
      requestId: 'verify_req',
      data: {
        requestId: 'verify_req',
        status: 'succeeded',
        startedAt: 1,
        updatedAt: 2,
        result: {
          draftId: 'draft_0',
          verify: { ok: true, rows: 1, fieldCount: 3, reasons: [] },
          usable: true,
          verifiedSourceHash: 'sha256-edited',
          verifiedAt: 1234,
        },
      },
      error: null,
    });

    const client = createHttpRecorderClient({ enabled: true, baseUrl: '/byaiService/recorder' });
    await client.bind('existing');
    const result = await client.draftVerify('draft_0', 'export const edited = true;');

    expect(POST).toHaveBeenNthCalledWith(
      2,
      '/byaiService/recorder/draft/verify',
      {
        sessionId: 'session_1',
        draftId: 'draft_0',
        source: 'export const edited = true;',
      },
      expect.any(Object)
    );
    expect(result.data).toEqual(
      expect.objectContaining({
        usable: true,
        verifiedSourceHash: 'sha256-edited',
        verifiedAt: 1234,
      })
    );
  });

  it('omits undefined verification source for backward compatibility', async () => {
    (POST as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        schemaVersion: 'recorder.v1',
        requestId: 'bind_req',
        data: { sessionId: 'session_1', contextId: 'ctx', targetId: 'target', awaitingLogin: false },
        error: null,
      })
      .mockResolvedValueOnce({ ok: false, schemaVersion: 'recorder.v1', requestId: '', data: null, error: null });

    const client = createHttpRecorderClient({ enabled: true, baseUrl: '/byaiService/recorder' });
    await client.bind('existing');
    await client.draftVerify('draft_0');

    expect((POST as jest.Mock).mock.calls[1][1]).toEqual({ sessionId: 'session_1', draftId: 'draft_0' });
  });

  it('defaults a single save to non-overwriting and derives the legacy adapterPath', async () => {
    (POST as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        schemaVersion: 'recorder.v1',
        requestId: 'bind_req',
        data: { sessionId: 'session_1', contextId: 'ctx', targetId: 'target', awaitingLogin: false },
        error: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        schemaVersion: 'recorder.v1',
        requestId: 'save_req',
        data: {
          state: 'ranked',
          draftId: 'draft_0',
          site: 'example_com',
          name: 'search',
          adapterPath: '/by/.bycli/clis/example_com/search.js',
          reportPath: '/by/.bycli/sites/example_com/recorder/search-report.json',
          saved: [
            {
              draftId: 'draft_0',
              site: 'example_com',
              name: 'search',
              adapterPath: '/by/.bycli/clis/example_com/search.js',
              reportPath: '/by/.bycli/sites/example_com/recorder/search-report.json',
            },
          ],
          failed: [],
        },
        error: null,
      });

    const client = createHttpRecorderClient({ enabled: true, baseUrl: '/byaiService/recorder' });
    await client.bind('existing');
    const result = await client.saveAdapter('draft_0', 'edited source');

    expect((POST as jest.Mock).mock.calls[1][1]).toEqual({
      sessionId: 'session_1',
      draftId: 'draft_0',
      source: 'edited source',
      overwrite: false,
    });
    expect(result.data).toEqual(
      expect.objectContaining({
        adapterPath: '/by/.bycli/clis/example_com/search.js',
        allSucceeded: true,
        saved: [
          expect.objectContaining({
            reportPath: '/by/.bycli/sites/example_com/recorder/search-report.json',
          }),
        ],
      })
    );
  });

  it('sends overwrite=true only when explicitly requested', async () => {
    (POST as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        schemaVersion: 'recorder.v1',
        requestId: 'bind_req',
        data: { sessionId: 'session_1', contextId: 'ctx', targetId: 'target', awaitingLogin: false },
        error: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        schemaVersion: 'recorder.v1',
        requestId: 'save_req',
        data: {
          state: 'ranked',
          draftId: 'draft_0',
          adapterPath: '/by/.bycli/clis/example_com/search.js',
          saved: [
            {
              draftId: 'draft_0',
              site: 'example_com',
              name: 'search',
              adapterPath: '/by/.bycli/clis/example_com/search.js',
            },
          ],
        },
        error: null,
      });

    const client = createHttpRecorderClient({ enabled: true, baseUrl: '/byaiService/recorder' });
    await client.bind('existing');
    await client.saveAdapter('draft_0', 'same verified source', true);

    expect((POST as jest.Mock).mock.calls[1][1]).toEqual({
      sessionId: 'session_1',
      draftId: 'draft_0',
      source: 'same verified source',
      overwrite: true,
    });
  });

  it('retains batch failure codes and reasons without reporting full success', async () => {
    (POST as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        schemaVersion: 'recorder.v1',
        requestId: 'bind_req',
        data: { sessionId: 'session_1', contextId: 'ctx', targetId: 'target', awaitingLogin: false },
        error: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        schemaVersion: 'recorder.v1',
        requestId: 'save_req',
        data: {
          state: 'ranked',
          saved: [],
          failed: [{ draftId: 'draft_0', code: 'daemon_unavailable', reason: 'user byCLI daemon is unavailable' }],
          allSucceeded: false,
        },
        error: null,
      });

    const client = createHttpRecorderClient({ enabled: true, baseUrl: '/byaiService/recorder' });
    await client.bind('existing');
    const result = await client.saveAdapters([{ draftId: 'draft_0', source: 'edited source' }]);

    expect((POST as jest.Mock).mock.calls[1][1]).toEqual({
      sessionId: 'session_1',
      drafts: [{ draftId: 'draft_0', source: 'edited source', overwrite: false }],
    });

    expect(result.data).toEqual(
      expect.objectContaining({
        allSucceeded: false,
        failed: [{ draftId: 'draft_0', code: 'daemon_unavailable', reason: 'user byCLI daemon is unavailable' }],
      })
    );
  });

  it('preserves per-item overwrite choices for batch saves', async () => {
    (POST as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        schemaVersion: 'recorder.v1',
        requestId: 'bind_req',
        data: { sessionId: 'session_1', contextId: 'ctx', targetId: 'target', awaitingLogin: false },
        error: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        schemaVersion: 'recorder.v1',
        requestId: 'save_req',
        data: { state: 'ranked', saved: [], failed: [], allSucceeded: false },
        error: null,
      });

    const client = createHttpRecorderClient({ enabled: true, baseUrl: '/byaiService/recorder' });
    await client.bind('existing');
    await client.saveAdapters([
      { draftId: 'draft_new', source: 'new source' },
      { draftId: 'draft_existing', source: 'verified source', overwrite: true },
    ]);

    expect((POST as jest.Mock).mock.calls[1][1]).toEqual({
      sessionId: 'session_1',
      drafts: [
        { draftId: 'draft_new', source: 'new source', overwrite: false },
        { draftId: 'draft_existing', source: 'verified source', overwrite: true },
      ],
    });
  });

  it('does not infer success from a malformed save envelope without any saved item', async () => {
    (POST as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        schemaVersion: 'recorder.v1',
        requestId: 'bind_req',
        data: { sessionId: 'session_1', contextId: 'ctx', targetId: 'target', awaitingLogin: false },
        error: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        schemaVersion: 'recorder.v1',
        requestId: 'save_req',
        data: { state: 'ranked' },
        error: null,
      });

    const client = createHttpRecorderClient({ enabled: true, baseUrl: '/byaiService/recorder' });
    await client.bind('existing');
    const result = await client.saveAdapter('draft_0', 'edited source');

    expect(result.data?.allSucceeded).toBe(false);
  });

  it('preserves an adapter conflict envelope rejected by the HTTP transport', async () => {
    const conflict = {
      ok: false,
      schemaVersion: 'recorder.v1' as const,
      requestId: 'save_conflict',
      data: null,
      error: {
        code: 'adapter_exists',
        message: 'An adapter already exists at this path.',
        details: { adapterPath: '/by/.bycli/clis/example_com/search.js' },
      },
    };
    (POST as jest.Mock).mockRejectedValueOnce({ response: { data: conflict } });

    const client = createHttpRecorderClient({ enabled: true, baseUrl: '/byaiService/recorder' });
    const result = await client.saveAdapter('draft_0', 'edited source');

    expect(result).toEqual(conflict);
  });

  it('maps a rejected envelope without an error message to network_error', async () => {
    (POST as jest.Mock).mockRejectedValueOnce({
      response: {
        data: {
          ok: false,
          schemaVersion: 'recorder.v1',
          requestId: 'save_conflict',
          data: null,
          error: { code: 'adapter_exists' },
        },
      },
    });

    const client = createHttpRecorderClient({ enabled: true, baseUrl: '/byaiService/recorder' });
    const result = await client.saveAdapter('draft_0', 'edited source');

    expect(result.error?.code).toBe('network_error');
  });

  it('maps a rejected envelope with an unknown error code to network_error', async () => {
    (POST as jest.Mock).mockRejectedValueOnce({
      response: {
        data: {
          ok: false,
          schemaVersion: 'recorder.v1',
          requestId: 'save_conflict',
          data: null,
          error: { code: 'not_recorder', message: 'x' },
        },
      },
    });

    const client = createHttpRecorderClient({ enabled: true, baseUrl: '/byaiService/recorder' });
    const result = await client.saveAdapter('draft_0', 'edited source');

    expect(result.error?.code).toBe('network_error');
  });

  it('maps a rejected envelope with malformed error details to network_error', async () => {
    (POST as jest.Mock).mockRejectedValueOnce({
      response: {
        data: {
          ok: false,
          schemaVersion: 'recorder.v1',
          requestId: 'save_conflict',
          data: null,
          error: { code: 'adapter_exists', message: 'x', details: 1 },
        },
      },
    });

    const client = createHttpRecorderClient({ enabled: true, baseUrl: '/byaiService/recorder' });
    const result = await client.saveAdapter('draft_0', 'edited source');

    expect(result.error?.code).toBe('network_error');
  });

  it('maps a rejected envelope with malformed error hint to network_error', async () => {
    (POST as jest.Mock).mockRejectedValueOnce({
      response: {
        data: {
          ok: false,
          schemaVersion: 'recorder.v1',
          requestId: 'save_conflict',
          data: null,
          error: { code: 'adapter_exists', message: 'x', hint: 1 },
        },
      },
    });

    const client = createHttpRecorderClient({ enabled: true, baseUrl: '/byaiService/recorder' });
    const result = await client.saveAdapter('draft_0', 'edited source');

    expect(result.error?.code).toBe('network_error');
  });
});
