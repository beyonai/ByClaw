import { buildVoiceSendProps, getVoiceDurationSeconds, getVoiceMessage } from './voice';

const voice = { fileId: 'voice-id', fileName: 'voice.mp3', durationMs: 3200, mimeType: 'audio/mpeg' };

describe('voice history envelope', () => {
  it('hydrates a persisted voice without replacing the original message text', () => {
    expect(getVoiceMessage({ metadata: JSON.stringify({ messageType: 'VOICE', voice }), text: '[语音消息]' })).toEqual(
      voice
    );
  });

  it('supports optimistic voice and legacy related-resource metadata', () => {
    expect(getVoiceMessage({ voice })).toEqual(voice);
    expect(getVoiceMessage({ extParams: { voice } } as any)).toEqual(voice);
  });

  it.each(['invalid JSON', '{"voice":null}', '{"voice":{"fileUrl":"/unsafe.mp3"}}'])(
    'leaves text messages intact for %s',
    (metadata) => expect(getVoiceMessage({ metadata })).toBeUndefined()
  );

  it('normalizes invalid duration and rounds elapsed seconds up', () => {
    expect(getVoiceMessage({ voice: { ...voice, durationMs: Number.NaN } })?.durationMs).toBe(0);
    expect(getVoiceDurationSeconds(3200)).toBe(4);
    expect(getVoiceDurationSeconds(0)).toBe(1);
  });
});

describe('voice sending contract', () => {
  it('routes the original uploaded MP3 to the same agent and persists the voice envelope', () => {
    const result = buildVoiceSendProps(
      {
        queryQuestion: 'unsent draft',
        payload: { agentId: 'default-agent', relModelId: 8, files: [{ fileId: 4 }], extParams: { requestId: 'req' } },
        msgOpt: { queryMsg: { creatorName: 'User' } },
      },
      voice,
      1024,
      '88'
    );
    expect(result.queryQuestion).toBe('[语音消息]');
    expect(result.displayText).toBe('[语音消息]');
    expect(result.payload).toMatchObject({
      sessionId: '88',
      chatId: '88',
      agentId: 'default-agent',
      relModelId: 8,
      messageType: 'VOICE',
      voice,
      extParams: { requestId: 'req', messageType: 'VOICE', voice },
      files: [{ fileId: 4 }, { ...voice, fileType: 'audio', fileSize: 1024 }],
    });
    expect(result.msgOpt?.queryMsg).toEqual({ creatorName: 'User', voice });
  });
});
