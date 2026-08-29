import { fireEvent, render, screen, within } from '@testing-library/react';

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
    expect(screen.getByText('知乎运营后台').closest('.accountCard')).not.toHaveClass('accountCardDrawerCompact');
  });

  it('pins a filtered login target and renders confirmation inside its card', () => {
    const onConfirmLogin = jest.fn();
    const onCancelLogin = jest.fn();

    const { container } = render(
      <OperationAccountPanel
        accounts={[
          {
            id: 2,
            platformId: 'CustomLink',
            accountName: 'ima',
            accountId: 'ima',
            customUrl: 'https://ima.qq.com/wikis/',
            loginStatus: 'logged_in',
          },
        ]}
        loginTarget={{
          id: 1,
          platformId: 'CustomLink',
          accountName: '小红书',
          accountId: 'xiaohongshu',
          customUrl: 'https://www.xiaohongshu.com/',
          loginStatus: 'logged_out',
        }}
        onLogin={jest.fn()}
        onConfirmLogin={onConfirmLogin}
        onCancelLogin={onCancelLogin}
      />
    );

    expect(container.querySelector('.accountLoginNotice')).not.toBeInTheDocument();
    const cards = container.querySelectorAll('.accountCard');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('小红书');
    expect(cards[0]).toHaveClass('accountCardLoginActive');
    expect(cards[0]).toHaveTextContent('projectSpace.operation.account.status.logging_in');
    expect(cards[0]).toHaveTextContent('projectSpace.operation.platform.customLink');
    expect(cards[0]).toHaveTextContent('projectSpace.operation.accountLogin.inlineHint');

    fireEvent.click(
      within(cards[0] as HTMLElement).getByRole('button', {
        name: 'projectSpace.operation.accountLogin.cancel',
      })
    );
    fireEvent.click(
      within(cards[0] as HTMLElement).getByRole('button', {
        name: 'projectSpace.operation.accountLogin.inlineComplete',
      })
    );
    expect(onCancelLogin).toHaveBeenCalledTimes(1);
    expect(onConfirmLogin).toHaveBeenCalledTimes(1);
  });

  it('keeps cancellation disabled while login confirmation is running', () => {
    render(
      <OperationAccountPanel
        accounts={[]}
        loginTarget={{
          id: 1,
          platformId: 'CustomLink',
          accountName: '小红书',
          accountId: 'xiaohongshu',
          customUrl: 'https://www.xiaohongshu.com/',
          loginStatus: 'logged_out',
        }}
        loginConfirming
        onLogin={jest.fn()}
        onConfirmLogin={jest.fn()}
        onCancelLogin={jest.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'projectSpace.operation.accountLogin.cancel' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /projectSpace\.operation\.accountLogin\.inlineComplete$/ })
    ).toHaveClass('ant-btn-loading');
  });
});
