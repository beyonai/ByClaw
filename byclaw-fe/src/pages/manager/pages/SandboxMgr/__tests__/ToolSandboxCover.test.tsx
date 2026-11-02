import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { message } from 'antd';
import ToolSandboxCover from '../ToolSandboxCover';
import { MAX_TOOL_COVER_BYTES } from '../serviceSpecUtils';

jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));

test('uploads a bounded bitmap as metadata and lets the editor clear it', async () => {
  const onChange = jest.fn();
  const { container, rerender } = render(<ToolSandboxCover onChange={onChange} />);
  const file = new File(['image-content'], 'cover.png', { type: 'image/png' });
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/)));
  rerender(<ToolSandboxCover value="data:image/png;base64,aGVsbG8=" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: /sandboxMgr.market.clearCover/ }));
  expect(onChange).toHaveBeenLastCalledWith('');
});

test('rejects oversized or vector covers without changing saved metadata', async () => {
  const error = jest.spyOn(message, 'error').mockImplementation(() => (() => {}) as any);
  const onChange = jest.fn();
  const { container } = render(<ToolSandboxCover onChange={onChange} />);
  const input = container.querySelector('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [new File(['<svg/>'], 'cover.svg', { type: 'image/svg+xml' })] } });
  await waitFor(() => expect(error).toHaveBeenCalled());
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [new File([new Uint8Array(MAX_TOOL_COVER_BYTES + 1)], 'huge.png', { type: 'image/png' })] },
  });
  await waitFor(() => expect(error).toHaveBeenCalledTimes(2));
  expect(onChange).not.toHaveBeenCalled();
  error.mockRestore();
});
