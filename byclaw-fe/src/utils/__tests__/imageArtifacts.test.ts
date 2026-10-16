import { structuredImagePaths } from '../imageArtifacts';
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
