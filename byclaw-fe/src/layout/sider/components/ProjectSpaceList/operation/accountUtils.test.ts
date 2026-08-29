import { buildGlobalOperationAccountPayload, normalizeOperationAccounts } from './accountUtils';

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
