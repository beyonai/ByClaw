import { GET, POST } from '@/service/common/request';

export type VoiceTranscriptionSource =
  | { fileId: string | number; sessionId?: string; path?: never }
  | { sessionId: string; path: string; fileId?: never };

export const transcribeVoice = (params: VoiceTranscriptionSource) =>
  POST<{ text: string }>('/byaiService/api/asr/transcribe', params, {
    timeout: 180000,
    responseCfg: { hideErrorTips: true },
  });

export const loadVoiceAudio = (fileId: string | number) =>
  GET<{ fileName: string; file: Blob }>(
    '/byaiService/api/asr/audio',
    { fileId },
    { responseType: 'blob', responseCfg: { hideErrorTips: true } }
  ).then((result) => result.file);
