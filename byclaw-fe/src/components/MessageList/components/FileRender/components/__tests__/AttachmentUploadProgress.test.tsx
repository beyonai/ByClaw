import { fireEvent, render, screen } from '@testing-library/react';
import AttachmentUploadProgress from '../AttachmentUploadProgress';

jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));

test('each attachment renders its own circular percentage and only the failed file offers retry', () => {
  const retry = jest.fn();
  const { rerender } = render(
    <>
      <AttachmentUploadProgress name="first.txt" percent={25} />
      <AttachmentUploadProgress name="second.txt" percent={70} />
    </>
  );
  expect(screen.getByRole('progressbar', { name: /first.txt/ })).toHaveAttribute('aria-valuenow', '25');
  expect(screen.getByRole('progressbar', { name: /second.txt/ })).toHaveAttribute('aria-valuenow', '70');
  rerender(
    <>
      <AttachmentUploadProgress name="first.txt" percent={25} error="connection lost" onRetry={retry} />
      <AttachmentUploadProgress name="second.txt" percent={70} />
    </>
  );
  fireEvent.click(screen.getByRole('button', { name: /first.txt/ }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('progressbar', { name: /second.txt/ })).toHaveAttribute('aria-valuenow', '70');
  expect(screen.queryByRole('button', { name: /second.txt/ })).not.toBeInTheDocument();
});
