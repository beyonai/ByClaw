jest.mock('@/utils/websocket', () => ({
  __esModule: true,
  default: {
    onMessage: jest.fn(),
    offMessage: jest.fn(),
  },
}));

jest.mock('@/hooks/useSseSender/util', () => ({
  answerDeltaHandler: jest.fn(),
  reasoningLogHandler: jest.fn(),
}));

import { formatStreamPayload } from '../useSseSender/chatStream';

describe('hooks/useSseSender/chatStream', () => {
  it('forwards session title update payloads', () => {
    expect(
      formatStreamPayload('sessionTitleUpdated', {
        sessionId: 's1',
        sessionName: '第一条用户文字',
      })
    ).toEqual({
      sessionId: 's1',
      sessionName: '第一条用户文字',
    });
  });
});
