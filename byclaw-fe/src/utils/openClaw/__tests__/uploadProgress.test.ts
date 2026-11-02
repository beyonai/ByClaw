import { uploadFileToOpenClaw } from '../utils';

jest.mock('@/utils/openClaw/openclawWebSocket', () => ({
  getOpenClawWebSocket: () => ({
    getWsUrl: () => 'wss://gateway.example/ws',
    getOriginUrl: () => 'http://sandbox.internal:3000',
  }),
}));

const requests: any[] = [];
const originalXHR = global.XMLHttpRequest;
const originalFetch = global.fetch;
beforeEach(() => {
  requests.length = 0;
  global.fetch = jest.fn().mockResolvedValue({ status: 200, json: async () => ({ paths: ['uploads/file.txt'] }) });
  global.XMLHttpRequest = class {
    upload = { onprogress: undefined };
    status = 200;
    statusText = 'OK';
    responseText = '{"paths":["uploads/file.txt"]}';
    onload?: () => void;
    onerror?: () => void;
    open = jest.fn();
    send = jest.fn();
    constructor() {
      requests.push(this);
    }
  } as any;
});
afterEach(() => {
  global.XMLHttpRequest = originalXHR;
  global.fetch = originalFetch;
});

test('the existing OpenClaw upload API reports request bytes and waits for the validated response', async () => {
  const progress = jest.fn();
  const file = new File(['hello'], 'file.txt', { type: 'text/plain' });
  const pending = uploadFileToOpenClaw(file, progress);
  expect(requests).toHaveLength(1);
  expect(requests[0].open).toHaveBeenCalledWith('POST', expect.stringContaining('/upload-file'));
  requests[0].upload.onprogress({ loaded: 2, total: 5, lengthComputable: true });
  expect(progress).toHaveBeenCalledWith({ loaded: 2, total: 5 });
  requests[0].onload();
  await expect(pending).resolves.toEqual(
    expect.objectContaining({ fileName: 'file.txt', fileUrl: 'uploads/file.txt', length: 5 })
  );
  expect(global.fetch).not.toHaveBeenCalled();
});

test('OpenClaw request failures reject the individual attachment upload', async () => {
  const pending = uploadFileToOpenClaw(new File(['hello'], 'file.txt'), jest.fn());
  expect(requests).toHaveLength(1);
  const rejected = expect(pending).rejects.toThrow();
  requests[0].onerror();
  await rejected;
});
