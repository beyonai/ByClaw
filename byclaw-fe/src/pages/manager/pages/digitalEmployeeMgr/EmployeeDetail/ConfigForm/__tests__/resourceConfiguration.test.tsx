import { act, fireEvent, render as renderComponent, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider, Form } from 'antd';
import { listResourceUseAuth } from '@/pages/manager/service/resources';
import ConfigForm from '..';
import { isSuperAssistant } from '../../resourceConfiguration';

// 此处验证资源配置行为，禁用弹窗动画，避免在入场准备阶段判断可见性。
const render = (ui: Parameters<typeof renderComponent>[0]) =>
  renderComponent(ui, {
    wrapper: ({ children }) => <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>,
  });

jest.mock('antd', () => {
  const actual = jest.requireActual('antd');
  return {
    ...actual,
    // motion token 不会移除 rc-dialog 的动画准备阶段；保留真实弹窗，只关闭过渡。
    Modal: Object.assign(
      (props: import('antd').ModalProps) => <actual.Modal {...props} transitionName="" maskTransitionName="" />,
      actual.Modal
    ),
  };
});

jest.mock('@umijs/max', () => {
  const intl = { formatMessage: ({ id }: { id: string }) => id };
  return { useIntl: () => intl, getIntl: () => intl, getLocale: () => 'en-US' };
});
jest.mock('@/pages/manager/service/System', () => ({ getByParamGroupCode: jest.fn().mockResolvedValue([]) }));
jest.mock('@/pages/manager/service/DigitalEmployeeMgr', () => ({
  getCatalogOnResource: jest.fn().mockResolvedValue({ code: 0, data: [] }),
  getDcSystemConfigListByStandType: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/pages/manager/service/session', () => ({
  getDcSystemConfig: jest.fn().mockResolvedValue({ paramValue: '[]' }),
}));
jest.mock('@/pages/manager/service/resources', () => ({
  listResourceUseAuth: jest.fn().mockResolvedValue({ list: [], total: 0 }),
  queryResourceDetailListByIds: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/pages/manager/hooks/useFileTookit', () => ({ useFileTookit: () => ({ pick: jest.fn() }) }));
jest.mock('@/pages/manager/utils/file', () => ({ compressImgFileAndUpload: jest.fn() }));
jest.mock('@/pages/manager/utils/agent', () => ({ getAvatarUrl: () => '' }));
jest.mock('@/utils/file', () => ({ getFileUrl: () => '' }));
jest.mock('@/pages/manager/components/Image', () => ({ Image: () => null }));
jest.mock(
  '@/pages/manager/components/AntdIcon',
  () =>
    ({ type, onClick }: any) =>
      onClick ? <button aria-label={type} onClick={onClick} /> : null
);
jest.mock('@/pages/manager/components/Ellipsis', () => ({ children }: any) => <span>{children}</span>);
jest.mock('../../../components/ModelPopover', () => () => null);
jest.mock('../ExampleModal', () => () => null);
jest.mock('../MemoryConfigModal', () => () => null);
jest.mock('../AbilityBoundaryModal', () => () => null);
jest.mock('../AbilityExampleModal', () => () => null);
jest.mock('../ToolSelectorModal', () => () => null);
jest.mock('../RobotModal', () => () => null);
jest.mock('../../EmployeeGroupMembers', () => () => <div>Configure Group Members</div>);

// 完整配置表单保留真实 antd 交互，全量并行运行时为渲染和多次切换预留时间。
// waitFor 仍使用默认超时，接口或状态断言失败不会被延长掩盖。
jest.setTimeout(15000);

const labels = [
  'employeeDetail.configureKnowledge',
  'employeeDetail.configureSkills',
  'employeeDetail.configureBundledSkills',
];
const mockShowBaseList = jest.fn();
const mockUpdateResource = jest.fn();
const noop = () => {};
const skills = [{ resourceId: '103', skillCode: 'search', label: 'Search skill', resourceDesc: 'Search' }];
const tools = [{ resourceId: '102', resourceName: 'Existing tool', grantResourceType: 'MCP' }];
const knowledge = [
  { id: 'KG_DOC', title: 'Documents', items: [{ resourceId: '101', resourceName: 'Existing knowledge' }] },
];
let editorForm: ReturnType<typeof Form.useForm>[0];

function Editor({ employee, canConfigureResources, agentType = '001' }: any) {
  const [form] = Form.useForm();
  editorForm = form;
  return (
    <ConfigForm
      agentId="employee-1"
      agentType={agentType}
      employeeType={agentType}
      ownerType={employee.ownerType}
      canConfigureResources={canConfigureResources ?? !isSuperAssistant(employee)}
      form={form}
      digitalType="FROM_MANUALLY"
      questionList={[]}
      selectedTools={tools}
      knowledgeBases={knowledge}
      tagOptions={[]}
      managementAddresses={[]}
      memoryRules={[]}
      modelList={[]}
      resultDataRef={{ current: { resourceId: 'employee-1' } }}
      prologueRef={{ current: {} }}
      setQuestionList={noop}
      setSelectedTools={noop}
      setKnowledgeBases={noop}
      setTagOptions={noop}
      setManagementAddresses={noop}
      setMemoryRules={noop}
      setModelName={noop}
      setAvatar={noop}
      setRefineModalOpen={noop}
      updateResource={mockUpdateResource}
      showBaseList={mockShowBaseList}
    />
  );
}

describe('employee editor resource configuration entries', () => {
  beforeEach(() => {
    mockShowBaseList.mockClear();
    mockUpdateResource.mockReset();
  });

  it.each(['personal', 'personal_default'])(
    'hides resource sections for a %s super assistant while keeping other settings',
    async (ownerType) => {
      render(<Editor employee={{ ownerType, resourceCode: 'alice_main' }} />);
      await waitFor(() => expect(screen.getByText('employeeDetail.robotConfig.title')).toBeVisible());

      labels.forEach((label) => expect(screen.queryByText(label)).not.toBeInTheDocument());
      expect(screen.queryByText('Existing knowledge')).not.toBeInTheDocument();
      expect(screen.queryByText('Existing tool')).not.toBeInTheDocument();
      expect(screen.getByText('employeeDetail.basicSettings')).toBeVisible();

      act(() => editorForm.setFieldsValue({ bundledSkills: skills }));
      expect(editorForm.getFieldValue('bundledSkills')).toEqual(skills);
      expect(screen.queryByText('Search skill')).not.toBeInTheDocument();
    }
  );

  it.each([
    { ownerType: 'personal', resourceCode: 'alice_helper' },
    { ownerType: 'enterprise', resourceCode: 'enterprise_main' },
  ])('keeps all resource entries usable for an ordinary assistant: %j', async (employee) => {
    render(<Editor employee={employee} />);
    await waitFor(() => expect(screen.getByText('employeeDetail.robotConfig.title')).toBeVisible());
    labels.forEach((label) => expect(screen.getByText(label)).toBeVisible());

    fireEvent.click(within(screen.getByText(labels[0]).parentElement!).getByRole('button'));
    expect(mockShowBaseList).toHaveBeenLastCalledWith('006');
    fireEvent.click(within(screen.getByText(labels[1]).parentElement!).getByRole('button'));
    expect(mockShowBaseList).toHaveBeenLastCalledWith('005');
    fireEvent.click(within(screen.getByText(labels[2]).parentElement!).getByRole('button'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
  });

  it('removes the last configured skill from both form fields before saving', async () => {
    render(<Editor employee={{ ownerType: 'personal', resourceCode: 'alice_helper' }} />);
    await waitFor(() => expect(screen.getByText('employeeDetail.basicSettings')).toBeVisible());
    act(() => editorForm.setFieldsValue({ bundledSkills: skills, role: JSON.stringify({ bundledSkills: skills }) }));
    const card = screen.getByText('Search skill').closest('.ant-card')!;
    mockUpdateResource.mockImplementation(() => {
      expect(editorForm.getFieldValue('bundledSkills')).toEqual([]);
      expect(JSON.parse(editorForm.getFieldValue('role')).bundledSkills).toEqual([]);
    });

    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: 'icon-a-Deleteshanchu' }));

    await waitFor(() => expect(mockUpdateResource).toHaveBeenCalled());
    expect(screen.queryByText('Search skill')).not.toBeInTheDocument();
    mockUpdateResource.mockReset();
  });

  it('closes the resource dialog when switching from an ordinary employee to a super assistant', async () => {
    const { rerender } = render(<Editor employee={{ ownerType: 'personal', resourceCode: 'alice_helper' }} />);
    fireEvent.click(within(screen.getByText(labels[2]).parentElement!).getByRole('button'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());

    rerender(<Editor employee={{ ownerType: 'personal', resourceCode: 'alice_main' }} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    labels.forEach((label) => expect(screen.queryByText(label)).not.toBeInTheDocument());
  });

  it('keeps entries hidden while employee details load and restores them for an ordinary employee', async () => {
    const employee = { ownerType: 'personal', resourceCode: 'alice_helper' };
    const { rerender } = render(<Editor employee={employee} canConfigureResources={false} />);
    labels.forEach((label) => expect(screen.queryByText(label)).not.toBeInTheDocument());
    expect(screen.getByText('employeeDetail.basicSettings')).toBeVisible();

    rerender(<Editor employee={employee} canConfigureResources />);
    await waitFor(() => labels.forEach((label) => expect(screen.getByText(label)).toBeVisible()));
  });

  it.each(['personal', 'personal_default'])(
    'hides group member configuration for a %s super assistant even when its agent type is 017',
    async (ownerType) => {
      render(<Editor employee={{ ownerType, resourceCode: 'alice_main' }} agentType="017" />);
      await waitFor(() => expect(screen.getByText('employeeDetail.basicSettings')).toBeVisible());
      expect(screen.queryByText('Configure Group Members')).not.toBeInTheDocument();
      labels.forEach((label) => expect(screen.queryByText(label)).not.toBeInTheDocument());
    }
  );

  it('removes group member configuration when switching to a super assistant and restores it for an ordinary group', async () => {
    const ordinaryGroup = { ownerType: 'personal', resourceCode: 'alice_team' };
    const { rerender } = render(<Editor employee={ordinaryGroup} agentType="017" />);
    await waitFor(() => expect(screen.getByText('Configure Group Members')).toBeVisible());

    rerender(<Editor employee={{ ownerType: 'personal', resourceCode: 'alice_main' }} agentType="017" />);
    expect(screen.queryByText('Configure Group Members')).not.toBeInTheDocument();

    rerender(<Editor employee={ordinaryGroup} agentType="017" />);
    await waitFor(() => expect(screen.getByText('Configure Group Members')).toBeVisible());
  });

  it.each(['personal', 'personal_default', 'enterprise'])(
    'keeps group member configuration and the existing hidden resource sections for ordinary %s groups',
    async (ownerType) => {
      render(<Editor employee={{ ownerType, resourceCode: 'team' }} agentType="017" />);
      await waitFor(() => expect(screen.getByText('Configure Group Members')).toBeVisible());
      labels.forEach((label) => expect(screen.getByText(label)).not.toBeVisible());
    }
  );
});

describe('skill configuration ownership tabs', () => {
  const listSkills = listResourceUseAuth as jest.Mock;
  const personalTab = 'employeeDetail.personalSkills';
  const enterpriseTab = 'employeeDetail.enterpriseSkills';
  const openSkills = () => fireEvent.click(within(screen.getByText(labels[2]).parentElement!).getByRole('button'));

  beforeEach(() => {
    listSkills.mockReset().mockResolvedValue({ list: [], total: 0 });
  });

  it.each(['personal', 'enterprise'])('shows the allowed tabs and queries the initial %s scope', async (ownerType) => {
    render(<Editor employee={{ ownerType, resourceCode: 'helper' }} />);
    openSkills();
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByRole('tab', { name: enterpriseTab })).toBeVisible();
    if (ownerType === 'personal') {
      expect(dialog.getByRole('tab', { name: personalTab })).toHaveAttribute('aria-selected', 'true');
    } else {
      expect(dialog.queryByRole('tab', { name: personalTab })).not.toBeInTheDocument();
      expect(dialog.getByRole('tab', { name: enterpriseTab })).toHaveAttribute('aria-selected', 'true');
    }
    await waitFor(() =>
      expect(listSkills).toHaveBeenLastCalledWith({
        resourceBizTypeList: ['SKILL'],
        ownerType,
        pageNum: 1,
        pageSize: 30,
        keyword: '',
      })
    );
  });

  it('resets search on tab switches and keeps selected skills across scopes', async () => {
    render(<Editor employee={{ ownerType: 'personal', resourceCode: 'helper' }} />);
    openSkills();
    await waitFor(() => expect(listSkills).toHaveBeenCalled());
    const dialog = within(screen.getByRole('dialog'));
    const input = dialog.getByPlaceholderText('employeeDetail.bundledSkillsSearchPlaceholder');
    fireEvent.change(input, { target: { value: 'search' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });
    await waitFor(() =>
      expect(listSkills).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ownerType: 'personal',
          keyword: 'search',
          pageNum: 1,
        })
      )
    );
    act(() => editorForm.setFieldsValue({ bundledSkills: skills }));
    fireEvent.click(dialog.getByRole('tab', { name: enterpriseTab }));
    await waitFor(() =>
      expect(listSkills).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ownerType: 'enterprise',
          keyword: '',
          pageNum: 1,
        })
      )
    );
    expect(input).toHaveValue('');
    expect(editorForm.getFieldValue('bundledSkills')).toEqual(
      expect.arrayContaining([expect.objectContaining({ resourceId: '103' })])
    );
    fireEvent.click(dialog.getByRole('tab', { name: personalTab }));
    await waitFor(() =>
      expect(listSkills).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ownerType: 'personal',
          keyword: '',
          pageNum: 1,
        })
      )
    );
  });

  it('ignores a personal response that arrives after switching to enterprise', async () => {
    let resolvePersonal!: (value: any) => void;
    listSkills.mockImplementation(({ ownerType }) =>
      ownerType === 'personal'
        ? new Promise((resolve) => {
            resolvePersonal = resolve;
          })
        : Promise.resolve({
            list: [{ resourceId: '202', resourceCode: 'enterprise', resourceName: 'Enterprise result' }],
            total: 1,
          })
    );
    render(<Editor employee={{ ownerType: 'personal', resourceCode: 'helper' }} />);
    openSkills();
    await waitFor(() => expect(resolvePersonal).toBeDefined());
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('tab', { name: enterpriseTab }));
    await waitFor(() => expect(dialog.getByText('Enterprise result')).toBeVisible());
    await act(async () =>
      resolvePersonal({
        list: [{ resourceId: '201', resourceCode: 'personal', resourceName: 'Stale personal result' }],
        total: 1,
      })
    );
    expect(dialog.queryByText('Stale personal result')).not.toBeInTheDocument();
    expect(dialog.getByText('Enterprise result')).toBeVisible();
  });

  it('switches to enterprise scope when the form ownership changes', async () => {
    render(<Editor employee={{ ownerType: 'personal', resourceCode: 'helper' }} />);
    openSkills();
    await waitFor(() => expect(listSkills).toHaveBeenCalled());
    act(() => editorForm.setFieldsValue({ ownerType: 'enterprise' }));
    const dialog = within(screen.getByRole('dialog'));
    await waitFor(() => expect(dialog.queryByRole('tab', { name: personalTab })).not.toBeInTheDocument());
    await waitFor(() =>
      expect(listSkills).toHaveBeenLastCalledWith(expect.objectContaining({ ownerType: 'enterprise' }))
    );
  });
});
