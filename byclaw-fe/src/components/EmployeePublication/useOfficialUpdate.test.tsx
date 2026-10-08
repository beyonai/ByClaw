import { act, fireEvent, render, screen } from '@testing-library/react';
import { previewPublication, publicationAction, saveOfficialUpdateDraft } from '@/service/employeePublication';
import useOfficialUpdate from './useOfficialUpdate';

jest.mock('@/service/employeePublication', () => ({
  previewPublication: jest.fn(),
  publicationAction: jest.fn(),
  saveOfficialUpdateDraft: jest.fn(),
}));
const draft = {
  publication: { requestId: '100', officialId: '20', employeeName: '官方 B', revision: 2 },
  dependencies: [],
};
let save: ReturnType<typeof useOfficialUpdate>['save'];
function Editor() {
  const update = useOfficialUpdate();
  save = update.save;
  return (
    <>
      {update.confirmationDialog}
      <span>{update.busy ? '保存中' : '可编辑'}</span>
    </>
  );
}
beforeEach(() => {
  jest.resetAllMocks();
  (saveOfficialUpdateDraft as jest.Mock).mockResolvedValue(draft);
  (previewPublication as jest.Mock).mockResolvedValue(draft);
  (publicationAction as jest.Mock).mockResolvedValue({ publication: { status: 'PENDING' } });
});
it('opens without creating an application and submits only after update confirmation', async () => {
  render(<Editor />);
  expect(saveOfficialUpdateDraft).not.toHaveBeenCalled();
  let saving: ReturnType<typeof save>;
  act(() => {
    saving = save('20', { resourceName: '修改后的 B' });
  });
  expect(await screen.findByText('确认提交员工更新')).toBeInTheDocument();
  expect(screen.getByText('审核通过后更新官方员工，审核期间大家继续使用当前版本。')).toBeInTheDocument();
  expect(saveOfficialUpdateDraft).toHaveBeenCalledWith('20', { resourceName: '修改后的 B' });
  expect(publicationAction).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '提交更新审核' }));
    expect(await saving).toBe('submitted');
  });
  expect(publicationAction).toHaveBeenCalledWith('submit', draft.publication);
  expect(screen.getByText('可编辑')).toBeInTheDocument();
});
it('retains a draft when returning to edit and prevents duplicate saves during confirmation', async () => {
  render(<Editor />);
  let saving: ReturnType<typeof save>;
  act(() => {
    saving = save('20', {});
    void save('20', {});
  });
  await screen.findByText('确认提交员工更新');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '返回修改' }));
    expect(await saving).toBe('draft');
  });
  expect(saveOfficialUpdateDraft).toHaveBeenCalledTimes(1);
  expect(publicationAction).not.toHaveBeenCalled();
});
it('does not report a submission when the server returns a refreshed draft requiring another confirmation', async () => {
  (publicationAction as jest.Mock).mockResolvedValue({
    ...draft,
    publication: { ...draft.publication, status: 'DRAFT' },
    sourceResourcesChanged: true,
  });
  render(<Editor />);
  let saving: ReturnType<typeof save>;
  act(() => {
    saving = save('20', {});
  });
  await screen.findByText('确认提交员工更新');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '提交更新审核' }));
    expect(await saving).toBe('draft');
  });
  expect(publicationAction).toHaveBeenCalledTimes(1);
});
it('unlocks after failure and allows a retry', async () => {
  (saveOfficialUpdateDraft as jest.Mock).mockRejectedValueOnce(new Error('待审核，不可覆盖'));
  render(<Editor />);
  await act(async () => {
    await expect(save('20', {})).rejects.toThrow('待审核');
  });
  expect(screen.getByText('可编辑')).toBeInTheDocument();
  let saving: ReturnType<typeof save>;
  act(() => {
    saving = save('20', {});
  });
  await screen.findByText('确认提交员工更新');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '返回修改' }));
    await saving;
  });
  expect(saveOfficialUpdateDraft).toHaveBeenCalledTimes(2);
});
