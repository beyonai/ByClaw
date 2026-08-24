import { downloadChatFileArtifact, resolveChatFileArtifacts } from '../chatFileArtifact';

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
});
