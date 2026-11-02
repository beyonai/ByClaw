let mockLocale = 'zh-CN';
jest.mock('@umijs/max', () => ({
  getIntl: () => jest.requireActual('@/testUtils/localeIntl').getLocaleIntl(mockLocale),
}));

import { browserSandboxServiceKey, buildGlobalOperationAccountPayload, normalizeOperationAccounts } from './accountUtils';

describe('operation account utilities', () => {
  it('normalizes custom account links returned by the backend', () => {
    expect(
      normalizeOperationAccounts([
        {
          accountId: 7,
          platformCode: 'CustomLink',
          accountName: 'ima',
          accountCode: 'custom',
          customUrl: 'https://ima.qq.com/wikis/',
          loginStatus: 'online',
        },
      ])
    ).toEqual([
      {
        id: 7,
        platformId: 'CustomLink',
        accountName: 'ima',
        accountId: 'custom',
        avatar: undefined,
        loginStatus: 'logged_in',
        metrics: undefined,
        canEdit: undefined,
        customUrl: 'https://ima.qq.com/wikis/',
      },
    ]);
  });

  it('builds a global account payload without a project id', () => {
    expect(
      buildGlobalOperationAccountPayload({
        platformId: 'CustomLink',
        accountName: 'ima',
        accountId: '',
        customUrl: 'https://ima.qq.com/wikis/',
      })
    ).toEqual({
      platformCode: 'CustomLink',
      accountCode: '',
      accountName: 'ima',
      customUrl: 'https://ima.qq.com/wikis/',
    });
  });
});

it('translates only missing custom-link labels and preserves account IDs and names', () => {
  mockLocale = 'en-US';
  const account = { accountId: '9223372036854775807', platformCode: 'CustomLink', accountCode: 'custom' };
  const [normalized] = normalizeOperationAccounts([account]);
  expect(normalized.accountName).toBe('Custom URL');
  expect(normalized.id).toBe(account.accountId);
  expect(normalizeOperationAccounts([{ ...account, accountName: '业务账号' }])[0].accountName).toBe('业务账号');
  mockLocale = 'zh-CN';
});

it('launches the sandbox that carries the user\'s browser', () => {
  // A user on the shared DSH host: BE names the tool sandbox.
  expect(browserSandboxServiceKey('byclaw-dsh-tools')).toBe('byclaw-dsh-tools');
  // Everyone else keeps the default remote-desktop sandbox.
  expect(browserSandboxServiceKey(null)).toBe('openclaw');
  expect(browserSandboxServiceKey(undefined)).toBe('openclaw');
  expect(browserSandboxServiceKey('')).toBe('openclaw');
});
