jest.mock('@/utils/openClaw/openclawWebSocket', () => ({
  getOpenClawWebSocket: jest.fn(),
}));

import { getOpenClawWebSocket } from '@/utils/openClaw/openclawWebSocket';
import {
  generateFilePrompt,
  getDownloadOpenClawFileUrl,
  isOpenClawAgent,
  parseFilePrompt,
  uploadFileToOpenClaw,
} from '../openClaw/utils';

const mockGetOpenClawWebSocket = getOpenClawWebSocket as jest.MockedFunction<typeof getOpenClawWebSocket>;

describe('utils/openClaw/utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('isOpenClawAgent detects openclaw agent type', () => {
    expect(isOpenClawAgent({ agentType: '013' } as any)).toBe(true);
    expect(isOpenClawAgent({ agentType: '001' } as any)).toBe(false);
  });

  it('generateFilePrompt and parseFilePrompt round-trip file context', () => {
    const prompt = generateFilePrompt('what is in this file?', {
      fileName: 'a.txt',
      filePath: 'workspace/a.txt',
      fileSize: 123,
    });

    const parsed = parseFilePrompt(prompt);
    expect(parsed.userQuestion).toBe('what is in this file?');
    expect(parsed.fileInfo).toEqual({
      fileName: 'a.txt',
      filePath: 'workspace/a.txt',
      fileSize: 123,
    });
  });

  it('builds download url from websocket host info', () => {
    mockGetOpenClawWebSocket.mockReturnValue({
      getWsUrl: () => 'wss://gw.example.com:443/byaiService/openclaw',
      getOriginUrl: () => 'https://127.0.0.1:8080/app?x=1',
    } as any);

    expect(getDownloadOpenClawFileUrl('/tmp/a.txt')).toBe(
      'https://gw.example.com:443/openclaw/download-file?port=8080&ip=127.0.0.1&path=/tmp/a.txt'
    );
  });

  it('uploads file to openclaw and maps response into query file info', async () => {
    mockGetOpenClawWebSocket.mockReturnValue({
      getWsUrl: () => 'wss://gw.example.com:443/byaiService/openclaw',
      getOriginUrl: () => 'https://127.0.0.1:8080/app?x=1',
    } as any);
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      json: jest.fn().mockResolvedValue({
        paths: ['/workspace/file.txt'],
      }),
    } as any);

    const file = new File(['hello'], 'file.txt', { type: 'text/plain' });
    Object.defineProperty(file, 'size', { value: 5 });

    await expect(uploadFileToOpenClaw(file)).resolves.toEqual(
      expect.objectContaining({
        fileName: 'file.txt',
        fileUrl: '/workspace/file.txt',
        contentType: 'text/plain',
        length: 5,
        uploadState: 'done',
      })
    );
  });
});
