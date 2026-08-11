import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SkillGroupCreateModal from '..';
import type { ResourceImportResult } from '@/pages/manager/service/resources';
import { message } from 'antd';
import { getSkillGroupDetail, pageSkillGroupMemberCandidates } from '@/pages/manager/service/resources';

let mockFormValues: Record<string, any> = {};
const mockForm = {
  getFieldValue: jest.fn((name: string) => mockFormValues[name]),
  resetFields: jest.fn(() => {
    mockFormValues = {};
  }),
  setFieldValue: jest.fn((name: string, value: any) => {
    mockFormValues[name] = value;
  }),
  setFieldsValue: jest.fn((values: Record<string, any>) => {
    mockFormValues = { ...mockFormValues, ...values };
  }),
  validateFields: jest.fn(),
};

const mockIntl = {
  formatMessage: ({ id }: { id: string }) => id,
};

jest.mock('@umijs/max', () => ({
  useIntl: () => mockIntl,
}));

jest.mock('antd', () => {
  const Button = ({ children, disabled, onClick, onMouseDown, type, ...rest }: any) => (
    <button
      type={type === 'submit' ? 'submit' : 'button'}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={onMouseDown}
      {...rest}
    >
      {children}
    </button>
  );
  const Input = (props: any) => <input {...props} />;
  Input.TextArea = (props: any) => <textarea {...props} />;

  return {
    Button,
    Form: Object.assign(({ children }: any) => <form>{children}</form>, {
      Item: ({ children }: any) => <div>{children}</div>,
      useForm: () => [mockForm],
    }),
    Input,
    message: {
      error: jest.fn(),
      success: jest.fn(),
    },
    Modal: ({ children, open }: any) => (open ? <div role="dialog">{children}</div> : null),
    Select: ({ popupRender, options }: any) => (
      <div>
        {popupRender(
          <div>
            {options.map((option: any) => (
              <span key={option.value}>{option.label}</span>
            ))}
          </div>
        )}
      </div>
    ),
    Tabs: ({ activeKey, items, onChange }: any) => (
      <div>
        {items.map((item: any) => (
          <button key={item.key} type="button" aria-pressed={activeKey === item.key} onClick={() => onChange(item.key)}>
            {item.label}
          </button>
        ))}
      </div>
    ),
    Upload: {
      Dragger: ({ children }: any) => <div>{children}</div>,
    },
  };
});

jest.mock('@ant-design/icons', () => ({
  InboxOutlined: () => null,
  UploadOutlined: () => null,
}));

jest.mock('@/pages/manager/service/resources', () => ({
  addSkillGroupMembers: jest.fn(),
  createSkillGroup: jest.fn(),
  getSkillGroupDetail: jest.fn(),
  pageSkillGroupMemberCandidates: jest.fn(),
  removeSkillGroupMembers: jest.fn(),
  updateSkillGroup: jest.fn(),
}));

jest.mock('@/service/file', () => ({ callDomainServiceByMultipart: jest.fn() }));
jest.mock('@/utils/file', () => ({ getFileUrl: jest.fn((path: string) => path) }));
jest.mock('../coverProcessor', () => ({ normalizeSkillGroupCover: jest.fn() }));

let mockImportResult: ResourceImportResult | undefined;
let mockResourceImportProps: any;
let mockResourceImportMountCount = 0;
const mockResourceImportUnmount = jest.fn();

jest.mock('../../ResourceImport', () => {
  const ReactModule = jest.requireActual('react');

  return (props: any) => {
    const [mountId] = ReactModule.useState(() => {
      mockResourceImportMountCount += 1;
      return mockResourceImportMountCount;
    });
    ReactModule.useEffect(() => () => mockResourceImportUnmount(mountId), [mountId]);
    mockResourceImportProps = props;
    if (!props.visible) return null;

    return (
      <div aria-label="personal skill import">
        <span>import mount {mountId}</span>
        <button type="button" onClick={() => props.onSuccess(mockImportResult)}>
          finish upload
        </button>
        <button type="button" onClick={props.onCancel}>
          cancel upload
        </button>
      </div>
    );
  };
});

const mockPageSkillGroupMemberCandidates = pageSkillGroupMemberCandidates as jest.Mock;
const mockGetSkillGroupDetail = getSkillGroupDetail as jest.Mock;

const initialCandidates = {
  list: [
    { resourceId: 'built-in-1', resourceName: 'Built-in skill', systemBuiltIn: true, creatorOwned: false },
    { resourceId: 'personal-1', resourceName: 'Existing personal', systemBuiltIn: false, creatorOwned: true },
  ],
};

const importedResult = (items: ResourceImportResult['items']): ResourceImportResult => ({
  total: items?.length || 0,
  success: items?.filter((item) => item.success).length || 0,
  failed: items?.filter((item) => !item.success).length || 0,
  items,
});

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const renderModal = (group: any = null) =>
  render(<SkillGroupCreateModal visible group={group} onCancel={jest.fn()} onSuccess={jest.fn()} />);

const openPersonalUpload = async () => {
  await screen.findByText('Built-in skill');
  expect(screen.queryByRole('button', { name: 'resource.skillGroup.uploadPersonalSkill' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /resource.skillGroup.personalSkills/ }));
  fireEvent.click(screen.getByRole('button', { name: 'resource.skillGroup.uploadPersonalSkill' }));
  expect(screen.getByLabelText('personal skill import')).toBeInTheDocument();
};

describe('SkillGroupCreateModal personal skill upload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFormValues = {};
    mockImportResult = undefined;
    mockResourceImportProps = undefined;
    mockResourceImportMountCount = 0;
    mockPageSkillGroupMemberCandidates.mockResolvedValue(initialCandidates);
    mockGetSkillGroupDetail.mockResolvedValue({ members: [{ resourceId: 'personal-1' }] });
  });

  it('shows the upload action only on the personal tab', async () => {
    renderModal();

    await screen.findByText('Built-in skill');
    expect(screen.queryByRole('button', { name: 'resource.skillGroup.uploadPersonalSkill' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /resource.skillGroup.personalSkills/ }));
    expect(screen.getByRole('button', { name: 'resource.skillGroup.uploadPersonalSkill' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /resource.skillGroup.builtInSkills/ }));
    expect(screen.queryByRole('button', { name: 'resource.skillGroup.uploadPersonalSkill' })).not.toBeInTheDocument();
  });

  it.each([
    ['new', null, undefined],
    ['edit', { resourceId: 'group-1', resourceName: 'Group', members: [{ resourceId: 'personal-1' }] }, 'group-1'],
  ])('opens the shared import modal with fixed personal props in %s mode', async (_mode, group, groupId) => {
    renderModal(group);
    await openPersonalUpload();

    expect(mockPageSkillGroupMemberCandidates).toHaveBeenCalledWith({
      keyword: '',
      pageNum: 1,
      pageSize: 100,
      ...(groupId ? { groupId } : {}),
    });
    expect(mockResourceImportProps).toMatchObject({
      visible: true,
      resourceName: 'common.skill',
      resourceType: 'SKILL',
      catalogId: '',
      catalogList: [],
      activeTab: 'personal',
    });
    await expect(mockResourceImportProps.saveTool()).resolves.toBeUndefined();
  });

  it('refreshes candidates and merges successful imported IDs with the existing selection', async () => {
    mockPageSkillGroupMemberCandidates.mockResolvedValueOnce(initialCandidates).mockResolvedValueOnce({
      rows: [
        ...initialCandidates.list,
        { resourceId: 'personal-2', resourceName: 'Imported personal', systemBuiltIn: false, creatorOwned: true },
      ],
    });
    mockImportResult = importedResult([
      { resourceId: 'personal-2', resourceCode: 'two', resourceName: 'Two', updated: false, success: true },
    ]);
    renderModal({ resourceId: 'group-1', resourceName: 'Group', members: [{ resourceId: 'personal-1' }] });
    await openPersonalUpload();

    fireEvent.click(screen.getByRole('button', { name: 'finish upload' }));

    await screen.findByText('Imported personal');
    expect(mockForm.setFieldValue).toHaveBeenLastCalledWith('skillIds', ['personal-1', 'personal-2']);
    expect(screen.queryByLabelText('personal skill import')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'resource.skillGroup.uploadPersonalSkill' })).toBeInTheDocument();
  });

  it('selects only successful IDs from a partial import', async () => {
    mockPageSkillGroupMemberCandidates
      .mockResolvedValueOnce(initialCandidates)
      .mockResolvedValueOnce(initialCandidates);
    mockImportResult = importedResult([
      { resourceId: 'personal-2', resourceCode: 'two', resourceName: 'Two', updated: false, success: true },
      { resourceId: 'personal-3', resourceCode: 'three', resourceName: 'Three', updated: false, success: false },
    ]);
    renderModal();
    await openPersonalUpload();

    fireEvent.click(screen.getByRole('button', { name: 'finish upload' }));

    await waitFor(() => expect(mockForm.setFieldValue).toHaveBeenCalledWith('skillIds', ['personal-2']));
    expect(mockForm.setFieldValue).not.toHaveBeenCalledWith('skillIds', expect.arrayContaining(['personal-3']));
  });

  it('cancels without refreshing candidates or changing selection', async () => {
    renderModal();
    await openPersonalUpload();

    fireEvent.click(screen.getByRole('button', { name: 'cancel upload' }));

    expect(screen.queryByLabelText('personal skill import')).not.toBeInTheDocument();
    expect(mockPageSkillGroupMemberCandidates).toHaveBeenCalledTimes(1);
    expect(mockForm.setFieldValue).not.toHaveBeenCalledWith('skillIds', expect.anything());
  });

  it('closes the import modal when the parent modal closes', async () => {
    const view = renderModal();
    await openPersonalUpload();

    view.rerender(<SkillGroupCreateModal visible={false} group={null} onCancel={jest.fn()} onSuccess={jest.fn()} />);

    await waitFor(() => expect(screen.queryByLabelText('personal skill import')).not.toBeInTheDocument());
  });

  it('unmounts the importer on parent close and remounts a fresh instance', async () => {
    const view = renderModal();
    await openPersonalUpload();
    expect(screen.getByText('import mount 1')).toBeInTheDocument();

    view.rerender(<SkillGroupCreateModal visible={false} group={null} onCancel={jest.fn()} onSuccess={jest.fn()} />);

    await waitFor(() => expect(mockResourceImportUnmount).toHaveBeenCalledWith(1));
    view.rerender(<SkillGroupCreateModal visible group={null} onCancel={jest.fn()} onSuccess={jest.fn()} />);
    await openPersonalUpload();
    expect(screen.getByText('import mount 2')).toBeInTheDocument();
  });

  it('does not apply a pending refresh after the parent modal closes', async () => {
    const refresh = createDeferred<typeof initialCandidates>();
    mockPageSkillGroupMemberCandidates.mockResolvedValueOnce(initialCandidates).mockReturnValueOnce(refresh.promise);
    mockImportResult = importedResult([
      { resourceId: 'personal-2', resourceCode: 'two', resourceName: 'Two', updated: false, success: true },
    ]);
    const view = renderModal();
    await openPersonalUpload();
    fireEvent.click(screen.getByRole('button', { name: 'finish upload' }));

    view.rerender(<SkillGroupCreateModal visible={false} group={null} onCancel={jest.fn()} onSuccess={jest.fn()} />);
    await act(async () => refresh.resolve(initialCandidates));

    expect(mockFormValues.skillIds).toBeUndefined();
    expect(mockForm.setFieldValue).not.toHaveBeenCalledWith('skillIds', ['personal-2']);
  });

  it('does not let a delayed edit detail erase an imported selection', async () => {
    const detail = createDeferred<{ members: Array<{ resourceId: string }> }>();
    mockGetSkillGroupDetail.mockReturnValueOnce(detail.promise);
    mockPageSkillGroupMemberCandidates
      .mockResolvedValueOnce(initialCandidates)
      .mockResolvedValueOnce(initialCandidates);
    mockImportResult = importedResult([
      { resourceId: 'personal-2', resourceCode: 'two', resourceName: 'Two', updated: false, success: true },
    ]);
    renderModal({ resourceId: 'group-1', resourceName: 'Group', members: [{ resourceId: 'personal-1' }] });
    await openPersonalUpload();
    fireEvent.click(screen.getByRole('button', { name: 'finish upload' }));
    await waitFor(() => expect(mockFormValues.skillIds).toEqual(['personal-1', 'personal-2']));

    await act(async () => detail.resolve({ members: [{ resourceId: 'personal-1' }] }));

    expect(mockFormValues.skillIds).toEqual(['personal-1', 'personal-2']);
  });

  it('reconciles an imported selection with authoritative delayed detail membership', async () => {
    const detail = createDeferred<{ members: Array<{ resourceId: string }> }>();
    mockGetSkillGroupDetail.mockReturnValueOnce(detail.promise);
    mockPageSkillGroupMemberCandidates
      .mockResolvedValueOnce(initialCandidates)
      .mockResolvedValueOnce(initialCandidates);
    mockImportResult = importedResult([
      { resourceId: 'personal-2', resourceCode: 'two', resourceName: 'Two', updated: false, success: true },
    ]);
    renderModal({ resourceId: 'group-1', resourceName: 'Group', members: [{ resourceId: 'personal-1' }] });
    await openPersonalUpload();
    fireEvent.click(screen.getByRole('button', { name: 'finish upload' }));
    await waitFor(() => expect(mockFormValues.skillIds).toEqual(['personal-1', 'personal-2']));

    await act(async () => detail.resolve({ members: [] }));

    expect(mockFormValues.skillIds).toEqual(['personal-2']);
  });

  it('keeps candidates and selection unchanged when the post-upload refresh fails', async () => {
    mockPageSkillGroupMemberCandidates
      .mockResolvedValueOnce(initialCandidates)
      .mockRejectedValueOnce(new Error('offline'));
    mockImportResult = importedResult([
      { resourceId: 'personal-2', resourceCode: 'two', resourceName: 'Two', updated: false, success: true },
    ]);
    renderModal();
    await openPersonalUpload();

    fireEvent.click(screen.getByRole('button', { name: 'finish upload' }));

    await waitFor(() => expect(message.error).toHaveBeenCalledWith('resource.skillGroup.uploadRefreshFailed'));
    expect(screen.getByText('Existing personal')).toBeInTheDocument();
    expect(mockForm.setFieldValue).not.toHaveBeenCalledWith('skillIds', expect.anything());
  });

  it('closes an all-failed import without refreshing or changing selection', async () => {
    mockImportResult = importedResult([
      { resourceId: 'personal-2', resourceCode: 'two', resourceName: 'Two', updated: false, success: false },
    ]);
    renderModal();
    await openPersonalUpload();

    fireEvent.click(screen.getByRole('button', { name: 'finish upload' }));

    expect(screen.queryByLabelText('personal skill import')).not.toBeInTheDocument();
    expect(mockPageSkillGroupMemberCandidates).toHaveBeenCalledTimes(1);
    expect(mockForm.setFieldValue).not.toHaveBeenCalledWith('skillIds', expect.anything());
  });
});
