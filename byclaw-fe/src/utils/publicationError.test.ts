import { publicationErrorMessage } from './publicationError';

describe('publication error messages', () => {
  it.each([
    ['具体拒绝原因', '具体拒绝原因'],
    [new Error('网络连接失败'), '网络连接失败'],
    [{ response: { data: { msg: '请先登录当前企业' } }, message: 'HTTP 400' }, '请先登录当前企业'],
    [{ msg: '配置无效' }, '配置无效'],
    [null, '操作失败'],
    ['', '操作失败'],
  ])('preserves the useful message from %p', (error, expected) => {
    expect(publicationErrorMessage(error, '操作失败')).toBe(expected);
  });
});
