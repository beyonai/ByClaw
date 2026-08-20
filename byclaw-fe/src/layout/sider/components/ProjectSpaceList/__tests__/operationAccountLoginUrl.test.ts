import { resolveOperationAccountLoginUrl } from '../operation/useOperationAccountLogin';
import type { OperationAccount } from '../operation/types';

const buildAccount = (overrides: Partial<OperationAccount>): OperationAccount => ({
  id: 1,
  platformId: 'CustomLink',
  accountName: '自定义链接',
  accountId: 'custom',
  ...overrides,
});

describe('resolveOperationAccountLoginUrl', () => {
  it('uses the account customUrl for the custom link platform', () => {
    expect(resolveOperationAccountLoginUrl(buildAccount({ customUrl: 'https://www.zhihu.com/' }))).toBe(
      'https://www.zhihu.com/'
    );
  });

  it('returns undefined when a custom link account has no url so the caller can warn instead of navigating', () => {
    expect(resolveOperationAccountLoginUrl(buildAccount({ customUrl: undefined }))).toBeUndefined();
  });

  it('keeps preset sites for the built-in platforms and ignores any stored customUrl', () => {
    expect(
      resolveOperationAccountLoginUrl(
        buildAccount({ platformId: 'Xiaohongshu', customUrl: 'https://example.com/' })
      )
    ).toBe('https://creator.xiaohongshu.com/');
    // 历史数据里存在短编码，登录入口需要继续兼容。
    expect(resolveOperationAccountLoginUrl(buildAccount({ platformId: 'douyin' }))).toBe(
      'https://creator.douyin.com/'
    );
  });

  it('returns undefined for an unknown platform', () => {
    expect(resolveOperationAccountLoginUrl(buildAccount({ platformId: 'Unknown' }))).toBeUndefined();
  });
});
