import { buildOperationAccountPayload, normalizeAccounts } from './index';

describe('ProjectAccounts custom link data', () => {
  it('keeps historical custom links visible when their name is empty', () => {
    expect(
      normalizeAccounts([
        {
          id: 1,
          platformCode: 'CustomLink',
          accountName: '',
          accountCode: 'custom',
          customUrl: 'http://localhost:3000/login',
        },
      ])
    ).toEqual([
      expect.objectContaining({
        accountName: '自定义链接',
        customUrl: 'http://localhost:3000/login',
      }),
    ]);
  });

  it('submits a custom link with its required name', () => {
    expect(
      buildOperationAccountPayload(7, {
        platformId: 'CustomLink',
        accountName: '内网运营后台',
        accountId: '',
        customUrl: 'http://intranet.local/login',
      })
    ).toEqual({
      projectId: 7,
      platformCode: 'CustomLink',
      accountCode: '',
      accountName: '内网运营后台',
      customUrl: 'http://intranet.local/login',
    });
  });
});
