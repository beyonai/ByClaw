import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}));

import OperationAccountFormModal from './OperationAccountFormModal';

const CUSTOM_LINK_OPTION = [{ value: 'CustomLink', label: 'Custom Link' }];

describe('OperationAccountFormModal', () => {
  it('requires a link name for custom links', async () => {
    const onSubmit = jest.fn();
    render(
      <OperationAccountFormModal open platformOptions={CUSTOM_LINK_OPTION} onCancel={jest.fn()} onSubmit={onSubmit} />
    );

    fireEvent.change(await screen.findByLabelText('projectSpace.operation.accountForm.field.customUrl'), {
      target: { value: 'https://www.zhihu.com/' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'projectSpace.operation.accountForm.save' }));

    expect(
      await screen.findByText('projectSpace.operation.accountForm.validation.customLinkNameRequired')
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the custom link name together with its url', async () => {
    const onSubmit = jest.fn();
    render(
      <OperationAccountFormModal open platformOptions={CUSTOM_LINK_OPTION} onCancel={jest.fn()} onSubmit={onSubmit} />
    );

    fireEvent.change(await screen.findByLabelText('projectSpace.operation.accountForm.field.customLinkName'), {
      target: { value: '知乎运营后台' },
    });
    fireEvent.change(screen.getByLabelText('projectSpace.operation.accountForm.field.customUrl'), {
      target: { value: 'https://www.zhihu.com/' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'projectSpace.operation.accountForm.save' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          platformId: 'CustomLink',
          accountName: '知乎运营后台',
          accountId: '',
          customUrl: 'https://www.zhihu.com/',
        }),
        undefined
      )
    );
  });

  it('hides the platform field and submits a fixed custom-link platform', async () => {
    const onSubmit = jest.fn();
    render(<OperationAccountFormModal open fixedPlatformId="CustomLink" onCancel={jest.fn()} onSubmit={onSubmit} />);

    expect(screen.queryByLabelText('projectSpace.operation.accountForm.field.platform')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    fireEvent.change(await screen.findByLabelText('projectSpace.operation.accountForm.field.customLinkName'), {
      target: { value: '微信公众号' },
    });
    fireEvent.change(screen.getByLabelText('projectSpace.operation.accountForm.field.customUrl'), {
      target: { value: 'https://mp.weixin.qq.com/' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'projectSpace.operation.accountForm.save' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          platformId: 'CustomLink',
          accountName: '微信公众号',
          accountId: '',
          customUrl: 'https://mp.weixin.qq.com/',
        }),
        undefined
      )
    );
  });
});
