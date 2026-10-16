import { PREVIEW_WORKER_TIMEOUT } from './binaryPreview';
import { PreviewWorkerClient } from './previewWorkerClient';

const makeWorker = () => ({
  postMessage: jest.fn(),
  terminate: jest.fn(),
  onmessage: null as any,
  onerror: null as any,
  onmessageerror: null as any,
});

describe('binary preview worker lifecycle', () => {
  afterEach(() => jest.useRealTimers());

  it('matches out-of-order replies to their requests and transfers file buffers', async () => {
    const worker = makeWorker();
    const client = new PreviewWorkerClient(worker as unknown as Worker);
    const buffer = new ArrayBuffer(4);
    const first = client.request('openImage', { buffer, type: 'tiff' }, [buffer]);
    const second = client.request('openZip', { buffer });
    expect(worker.postMessage).toHaveBeenNthCalledWith(
      1,
      { id: 1, operation: 'openImage', input: { buffer, type: 'tiff' } },
      [buffer]
    );
    worker.onmessage({ data: { id: 2, result: [] } });
    worker.onmessage({ data: { id: 1, result: 2 } });
    await expect(first).resolves.toBe(2);
    await expect(second).resolves.toEqual([]);
    client.dispose();
  });

  it('terminates timed-out decoding and rejects pending work instead of hanging', async () => {
    jest.useFakeTimers();
    const worker = makeWorker();
    const client = new PreviewWorkerClient(worker as unknown as Worker);
    const pending = client.request('imagePage', { page: 0 }).catch((error) => error);
    jest.advanceTimersByTime(PREVIEW_WORKER_TIMEOUT);
    expect(await pending).toMatchObject({ code: 'timeout' });
    expect(worker.terminate).toHaveBeenCalled();
    await expect(client.request('imagePage', { page: 1 })).rejects.toMatchObject({ code: 'closed' });
  });

  it.each(['dispose', 'onerror', 'onmessageerror'])('cancels queued work on %s', async (method) => {
    const worker = makeWorker();
    const client = new PreviewWorkerClient(worker as unknown as Worker);
    const pending = client.request('imagePage', { page: 0 }).catch((error) => error);
    if (method === 'dispose') client.dispose();
    else worker[method as 'onerror' | 'onmessageerror']();
    expect(await pending).toMatchObject({ code: method === 'dispose' ? 'closed' : 'invalid' });
    expect(worker.terminate).toHaveBeenCalled();
  });
});
