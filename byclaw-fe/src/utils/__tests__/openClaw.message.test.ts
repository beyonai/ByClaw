jest.mock('@/utils', () => ({
  getModelState: jest.fn(() => ({
    userInfo: {
      userId: 'u1',
      userName: 'Alice',
    },
  })),
}));

jest.mock('../openClaw/utils', () => ({
  getDownloadOpenClawFileUrl: jest.fn((path: string) => `download:${path}`),
  parseFilePrompt: jest.fn((text: string) => {
    if (text.startsWith('<openclaw_file_context>')) {
      return {
        userQuestion: 'ask',
        fileInfo: {
          fileName: 'a.txt',
          filePath: 'workspace/a.txt',
          fileSize: 123,
        },
      };
    }
    return {
      userQuestion: text,
      fileInfo: null,
    };
  }),
}));

import { convertOpenClawToIMessage } from '../openClaw/openclawMessage';

describe('utils/openClaw/openclawMessage', () => {
  it('converts user and assistant history items into message rows', () => {
    const history = [
      {
        role: 'user',
        content:
          '<openclaw_file_context>{"fileName":"a.txt","filePath":"workspace/a.txt","fileSize":123}</openclaw_file_context>\nask',
        timestamp: '100',
      },
      {
        role: 'assistant',
        content: 'see https://host/download-file?path=%2Ftmp%2Fa.txt',
        timestamp: '101',
      },
    ] as any;

    const result = convertOpenClawToIMessage(history, 'session-1', 'agent-1');

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      fromBeyond: false,
      messageContent: 'ask',
      relatedResources: JSON.stringify({
        files: [
          {
            fileName: 'a.txt',
            filePath: 'workspace/a.txt',
            fileSize: 123,
            fileId: 1,
            fileType: 'file',
            fileUrl: 'workspace/a.txt',
            downloadUrl: 'download:workspace/a.txt',
          },
        ],
      }),
    });
    expect(result[1]).toMatchObject({
      fromBeyond: true,
      metadata: JSON.stringify({ agentId: 'agent-1' }),
    });
  });
});
