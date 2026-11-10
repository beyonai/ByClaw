import XunfeiSTT from './index';

jest.mock('@/utils/encrypt/sm', () => ({ decryptBySM: (value: string) => value }));
jest.mock('@umijs/max', () => ({ getIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));

it('delivers the last recognized words before completing the dictation', () => {
  const results: string[] = [];
  const stt = new XunfeiSTT({
    sttParams: { id: 'test-app', key: 'test-key', secret: 'test-secret' },
    onRecognized: (text) => results.push(text),
    onComplete: () => results.push('done'),
  });
  stt.renderResult(JSON.stringify({ code: 0, data: { status: 1, result: { ws: [{ cw: [{ w: '你好' }] }] } } }));
  stt.renderResult(JSON.stringify({ code: 0, data: { status: 2, result: { ws: [{ cw: [{ w: '世界' }] }] } } }));
  expect(results).toEqual(['你好', '世界', 'done']);
});
