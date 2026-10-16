import type { ISendProps } from '@/hooks/useChat';
import type { IMessage } from '@/typescript/message';

export type VoiceMessage = {
  fileId: string | number;
  fileUrl?: string;
  fileName: string;
  durationMs: number;
  mimeType: string;
  transcript?: string;
};

/** Read the same voice envelope from optimistic messages and persisted history. */
export function getVoiceMessage(message: Partial<IMessage>): VoiceMessage | undefined {
  let metadata: Record<string, any> = {};
  try {
    metadata = typeof message.metadata === 'string' ? JSON.parse(message.metadata || '{}') : message.metadata || {};
  } catch {
    // Older messages can contain plain metadata; they remain ordinary text messages.
  }
  const voice = message.voice || metadata.voice || (message.extParams as any)?.voice;
  if (!voice || !['string', 'number'].includes(typeof voice.fileId) || !`${voice.fileId}`.trim()) return undefined;
  return {
    ...voice,
    fileName: voice.fileName || 'voice.mp3',
    durationMs: Number.isFinite(Number(voice.durationMs)) ? Math.max(0, Number(voice.durationMs)) : 0,
    mimeType: voice.mimeType || 'audio/mpeg',
  };
}

export const getVoiceDurationSeconds = (durationMs: number) => Math.max(1, Math.ceil(durationMs / 1000));

/** Keep the message envelope identical for the main agent, other agents and history. */
export function buildVoiceSendProps(
  initial: ISendProps,
  voice: VoiceMessage,
  fileSize: number,
  uploadedSessionId?: string | number
): ISendProps {
  return {
    ...initial,
    queryQuestion: '[语音消息]',
    displayText: '[语音消息]',
    payload: {
      ...initial.payload,
      ...(uploadedSessionId ? { sessionId: `${uploadedSessionId}`, chatId: `${uploadedSessionId}` } : {}),
      messageType: 'VOICE',
      voice,
      files: [...((initial.payload?.files as any[]) || []), { ...voice, fileType: 'audio', fileSize }],
      extParams: { ...(initial.payload?.extParams as object), messageType: 'VOICE', voice },
    },
    msgOpt: { ...initial.msgOpt, queryMsg: { ...initial.msgOpt?.queryMsg, voice } },
  };
}
