import { GET, POST } from '@/service/common/request';
import { loadVoiceAudio, transcribeVoice } from '../voice';

jest.mock('@/service/common/request', () => ({ GET: jest.fn(), POST: jest.fn() }));

it('unwraps the authenticated download envelope into a playable Blob', async () => {
  const file = new Blob(['mp3'], { type: 'audio/mpeg' });
  (GET as jest.Mock).mockResolvedValue({ fileName: 'voice.mp3', file });
  expect(await loadVoiceAudio('123')).toBe(file);
  expect(GET).toHaveBeenCalledWith(
    '/byaiService/api/asr/audio',
    { fileId: '123' },
    expect.objectContaining({ responseType: 'blob' })
  );
});

it('calls global ASR only on an explicit transcription request', async () => {
  (POST as jest.Mock).mockResolvedValue({ text: '你好' });
  expect(await transcribeVoice({ fileId: '123', sessionId: '88' })).toEqual({ text: '你好' });
  expect(POST).toHaveBeenCalledWith(
    '/byaiService/api/asr/transcribe',
    { fileId: '123', sessionId: '88' },
    expect.any(Object)
  );
});

it('transcribes an owned generated artifact without inventing a file id', async () => {
  await transcribeVoice({ sessionId: '101', path: '/.sessions/101/tts/summary.mp3' });
  expect(POST).toHaveBeenCalledWith(
    '/byaiService/api/asr/transcribe',
    { sessionId: '101', path: '/.sessions/101/tts/summary.mp3' },
    expect.any(Object)
  );
});
