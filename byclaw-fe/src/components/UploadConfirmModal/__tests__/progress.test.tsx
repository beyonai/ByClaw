import { fireEvent, render, screen, within } from '@testing-library/react';
import UploadConfirmModal from '..';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

it('keeps failed upload progress and the resume instructions visible while retry stays available', () => {
  render(
    <UploadConfirmModal
      open
      files={[{ name: 'large.bin', size: 16 * 1024 * 1024 }]}
      directoryPath="/by/.sessions/"
      onOk={jest.fn()}
      onCancel={jest.fn()}
      progress={{ percent: 50, label: 'Uploading large.bin', failed: true, hint: 'Reselect the same file to resume' }}
    />
  );
  expect(screen.getByText('Uploading large.bin')).toBeInTheDocument();
  expect(screen.getByText('Reselect the same file to resume')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'knowledgeDetail.uploadFile' })).toBeEnabled();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
});

it('renders a separate linear bar and retries only the failed file while its sibling continues', () => {
  const retry = jest.fn();
  const { container } = render(
    <UploadConfirmModal
      open
      files={[]}
      directoryPath="/by/"
      onOk={jest.fn()}
      onCancel={jest.fn()}
      loading
      onRetryFile={retry}
      fileProgress={[
        { id: 'a', name: 'a.bin', percent: 25, label: 'Failed a', status: 'failed' },
        { id: 'b', name: 'b.bin', percent: 75, label: 'Uploading b', status: 'uploading' },
      ]}
    />
  );
  const first = container.ownerDocument.querySelector('[data-upload-id="a"]') as HTMLElement;
  const second = container.ownerDocument.querySelector('[data-upload-id="b"]') as HTMLElement;
  expect(within(first).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  expect(within(second).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');
  fireEvent.click(within(first).getByRole('button', { name: 'fileBrowser.upload.retryFile' }));
  expect(retry).toHaveBeenCalledWith('a');
  expect(within(second).queryByRole('button')).toBeNull();
});
