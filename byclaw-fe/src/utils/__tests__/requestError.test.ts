import { getRequestErrorMessage } from '../requestError';

describe('request error messages', () => {
  it.each([
    ['业务错误', '业务错误'],
    [new Error('审核失败'), '审核失败'],
    [{ msg: '授权已失效' }, '授权已失效'],
    [{ message: 'network', response: { data: { msg: '资源已下架' } } }, '资源已下架'],
    [undefined, '操作失败'],
    [{ msg: {}, message: '' }, '操作失败'],
  ])('preserves useful backend reasons and has a fallback', (error, expected) => {
    expect(getRequestErrorMessage(error, '操作失败')).toBe(expected);
  });
});
