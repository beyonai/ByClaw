import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ResourceEdit from '..';

jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: any) => id }) }));
jest.mock('@/utils/file', () => ({ compressImgFileAndUpload: jest.fn(), getFileUrl: (value: string) => value }));
jest.mock('@/pages/manager/service/resources', () => ({ generateResourceImage: jest.fn() }));

const item = { resourceId: '123', resourceName: 'design-taste-frontend', resourceDesc: 'Frontend design' };
const props = { visible: true, item, resourceType: 'SKILL', catalogList: [], onCancel: jest.fn() };

it('submits edited skill values once and shows saving until the request completes', async () => {
  let complete!: () => void;
  const onSave = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      })
  );
  render(<ResourceEdit {...props} onSave={onSave} />);
  fireEvent.change(await screen.findByDisplayValue('Frontend design'), { target: { value: 'Updated description' } });
  const save = screen.getByRole('button', { name: 'common.save' });
  fireEvent.click(save);
  fireEvent.click(save);
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ resourceId: '123', resourceDesc: 'Updated description' })
  );
  expect(save).toHaveClass('ant-btn-loading');
  expect(screen.getByRole('button', { name: 'common.cancel' })).toBeDisabled();
  complete();
  await waitFor(() => expect(save).not.toHaveClass('ant-btn-loading'));
});

it('retains the edited draft after a failed save and allows retry', async () => {
  const onSave = jest.fn().mockRejectedValueOnce(new Error('Save request failed')).mockResolvedValueOnce(undefined);
  render(<ResourceEdit {...props} onSave={onSave} />);
  fireEvent.change(await screen.findByDisplayValue('Frontend design'), { target: { value: 'Keep this draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  await screen.findByText('Save request failed');
  expect(screen.getByDisplayValue('Keep this draft')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
});

it('shows field validation without submitting an empty skill name', async () => {
  const onSave = jest.fn();
  render(<ResourceEdit {...props} onSave={onSave} />);
  fireEvent.change(await screen.findByDisplayValue(item.resourceName), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  await screen.findByText('form.input');
  expect(onSave).not.toHaveBeenCalled();
});
