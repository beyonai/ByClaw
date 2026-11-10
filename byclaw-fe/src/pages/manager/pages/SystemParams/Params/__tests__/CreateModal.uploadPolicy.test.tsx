import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CreateModal from '../CreateModal';
import { updateSystemConfig } from '@/pages/manager/service/System';

jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));
jest.mock('@/pages/manager/service/System', () => ({ saveSystemConfig: jest.fn(), updateSystemConfig: jest.fn() }));

it('edits resumable fields in the existing system parameter JSON without dropping its other values', async () => {
  (updateSystemConfig as jest.Mock).mockResolvedValue({ code: 0, msg: 'saved' });
  render(
    <CreateModal
      open
      onClose={jest.fn()}
      onSuccess={jest.fn()}
      record={{
        paramCode: 'DIG_EMPLOYEE_FILE_UPLOAD_CONFIG',
        paramName: 'Uploads',
        paramEnName: 'Uploads',
        paramDesc: '',
        paramValue: JSON.stringify({ enabled: false, maxFileSize: 512, maxFileCount: 3, custom: 'keep' }),
      }}
    />
  );
  const chunk = await screen.findByRole('spinbutton', { name: 'SystemParams.uploadPolicy.chunkSize' });
  expect(chunk).toHaveValue('4');
  fireEvent.change(chunk, { target: { value: '8' } });
  fireEvent.blur(chunk);
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(updateSystemConfig).toHaveBeenCalledTimes(1));
  expect(JSON.parse((updateSystemConfig as jest.Mock).mock.calls[0][0].paramValue)).toEqual({
    enabled: false,
    maxFileSize: 512,
    maxFileCount: 3,
    custom: 'keep',
    resumableMaxFileSizeMB: 4096,
    resumableChunkSizeMB: 8,
  });
});
