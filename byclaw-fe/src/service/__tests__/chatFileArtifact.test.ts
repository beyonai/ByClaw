import {
  downloadChatFileArtifact,
  downloadRelativeChatFileArtifact,
  resolveChatFileArtifacts,
} from '../chatFileArtifact';

jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
  POST: jest.fn(),
}));

import { GET, POST } from '@/service/common/request';

const mockGET = GET as jest.MockedFunction<typeof GET>;
const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('chat file artifact service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves reply paths in one request', () => {
    const request = {
      sessionId: '101',
      messageId: 'm1',
      paths: ['/by/.sessions/101/output/report.pptx'],
    };

    resolveChatFileArtifacts(request);

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/chat/file-artifacts/resolve', request);
  });

  it('downloads through the authenticated request client', () => {
    downloadChatFileArtifact({ sessionId: '101', path: '/.sessions/101/output/report.pptx' });

    expect(mockGET).toHaveBeenCalledWith(
      '/byaiService/chat/file-artifacts/download',
      { sessionId: '101', path: '/.sessions/101/output/report.pptx' },
      { responseType: 'blob' }
    );
  });

  it('resolves a Chinese relative link in its message session before downloading', async () => {
    const path = '/.sessions/101/故地重游-高考作文.txt';
    const file = new Blob(['作文']);
    mockPOST.mockResolvedValueOnce([{ sourcePath: `/by${path}`, path, fileName: '故地重游-高考作文.txt' }]);
    mockGET.mockResolvedValueOnce({ file, fileName: '故地重游-高考作文.txt' });
    await expect(
      downloadRelativeChatFileArtifact({ href: '故地重游-高考作文.txt', sessionId: '101', messageId: 'reply-1' })
    ).resolves.toEqual({ file, fileName: '故地重游-高考作文.txt', path });
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/chat/file-artifacts/resolve', {
      sessionId: '101',
      messageId: 'reply-1',
      paths: [path],
    });
    expect(mockGET).toHaveBeenCalledWith(
      '/byaiService/chat/file-artifacts/download',
      { sessionId: '101', path },
      {
        responseType: 'blob',
      }
    );
  });

  it.each([
    { artifacts: [] },
    { artifacts: [{ sourcePath: '/.sessions/102/report.txt', path: '/.sessions/102/report.txt' }] },
  ])('does not download an absent file or an unrelated resolver result: %j', async ({ artifacts }) => {
    mockPOST.mockResolvedValueOnce(artifacts);
    await expect(downloadRelativeChatFileArtifact({ href: 'report.txt', sessionId: '101' })).rejects.toThrow(
      'Session file not found'
    );
    expect(mockGET).not.toHaveBeenCalled();
  });

  it.each([
    { href: 'report.txt' },
    { href: '../report.txt', sessionId: '101' },
    { href: '%2e%2e/report.txt', sessionId: '101' },
  ])('rejects missing context and escaping paths before any request: %j', async (params) => {
    await expect(downloadRelativeChatFileArtifact(params)).rejects.toThrow('Invalid session file link');
    expect(mockPOST).not.toHaveBeenCalled();
    expect(mockGET).not.toHaveBeenCalled();
  });
});
