import { render, screen } from '@testing-library/react';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}));

import OperationAccountPanel from './OperationAccountPanel';

describe('OperationAccountPanel', () => {
  it('shows the custom url instead of the generated account code', () => {
    render(
      <OperationAccountPanel
        accounts={[
          {
            id: 1,
            platformId: 'CustomLink',
            accountName: '知乎运营后台',
            accountId: 'custom',
            customUrl: 'https://www.zhihu.com/creator',
            loginStatus: 'logged_in',
          },
        ]}
        platformOptions={[{ value: 'CustomLink', label: '自定义链接', mark: '自' }]}
      />
    );

    expect(screen.getByText('知乎运营后台')).toBeInTheDocument();
    expect(screen.getByText('https://www.zhihu.com/creator')).toHaveAttribute('title', 'https://www.zhihu.com/creator');
    expect(screen.queryByText('custom')).not.toBeInTheDocument();
  });
});
