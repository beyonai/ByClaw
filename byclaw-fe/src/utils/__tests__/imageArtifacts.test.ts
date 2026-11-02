import { structuredAudioPaths, structuredImagePaths } from '../imageArtifacts';
import type { IMessage } from '@/typescript/message';

test('history and streamed tool envelopes recover images without a final prose path and deduplicate', () => {
  const output = JSON.stringify({
    imageArtifacts: [{ schemaVersion: 1, id: 'first.png', path: '/by/.sessions/100/image/first.png' }],
  });
  const entry = { content: { substance: JSON.stringify({ output }) } };
  expect(structuredImagePaths({ messageList: [entry], thinkList: [entry], text: '完成' } as IMessage)).toEqual([
    '/by/.sessions/100/image/first.png',
  ]);
});
test('earlier tool activity never consumes the budget for a later generated image', () => {
  const ordinary = {
    content: { substance: JSON.stringify({ output: 'ok' }) },
    orginContent: JSON.stringify({ output: 'ok' }),
  };
  const image = {
    content: {
      substance: JSON.stringify({
        output: { imageArtifacts: [{ schemaVersion: 1, id: 'last.png', path: '/by/.sessions/100/image/last.png' }] },
      }),
    },
  };
  expect(structuredImagePaths({ thinkList: [...Array(200).fill(ordinary), image] } as IMessage)).toEqual([
    '/by/.sessions/100/image/last.png',
  ]);
});

test('collects every speech tool result from history and stream envelopes without prose paths', () => {
  const entries = ['vivi', 'xiaohe', 'yunzhou', 'xiaotian'].map((name) => ({
    content: {
      substance: JSON.stringify({
        output: JSON.stringify({
          provider: 'VOLCENGINE',
          model: 'seed-tts-2.0',
          artifacts: [
            { path: `/by/.sessions/100/tts/${name}.mp3`, mimeType: 'audio/mpeg', bytes: 100 },
            { path: `/by/.sessions/100/tts/${name}.json`, mimeType: 'application/json', bytes: 50 },
          ],
        }),
      }),
    },
  }));
  expect(structuredAudioPaths({ messageList: entries, thinkList: entries, text: '4 段已就绪' } as IMessage)).toEqual([
    '/by/.sessions/100/tts/vivi.mp3',
    '/by/.sessions/100/tts/xiaohe.mp3',
    '/by/.sessions/100/tts/yunzhou.mp3',
    '/by/.sessions/100/tts/xiaotian.mp3',
  ]);
});

test('accepts executor audio paths but ignores URLs, unrelated artifacts and arbitrary prose', () => {
  const artifacts = [
    { path: '/tmp/storage/byclaw-user/by/.sessions/100/tts/speech.mp3', mimeType: 'audio/mpeg' },
    { path: 'https://example.com/tts/speech.mp3', mimeType: 'audio/mpeg' },
    { path: '/by/.sessions/100/tts/words.json', mimeType: 'application/json' },
    { path: '/by/.sessions/100/tts/not-audio.mp3', mimeType: 'text/plain' },
    null,
  ];
  expect(structuredAudioPaths({ thinkList: [{ content: { output: { artifacts } } }] } as unknown as IMessage)).toEqual([
    '/tmp/storage/byclaw-user/by/.sessions/100/tts/speech.mp3',
  ]);
  expect(structuredAudioPaths({ text: JSON.stringify({ artifacts }) } as IMessage)).toEqual([]);
});
