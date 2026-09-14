import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Form } from 'antd';
import ConfigForm from '..';
import { isSuperAssistant } from '../../resourceConfiguration';

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
jest.mock('@/pages/manager/components/AntdIcon', () => () => null);
jest.mock('@/pages/manager/components/Ellipsis', () => ({ children }: any) => <span>{children}</span>);
jest.mock('../../../components/ModelPopover', () => () => null);
jest.mock('../ExampleModal', () => () => null);
jest.mock('../MemoryConfigModal', () => () => null);
jest.mock('../AbilityBoundaryModal', () => () => null);
jest.mock('../AbilityExampleModal', () => () => null);
jest.mock('../ToolSelectorModal', () => () => null);
jest.mock('../RobotModal', () => () => null);
jest.mock('../../EmployeeGroupMembers', () => () => <div>Configure Group Members</div>);

const labels = [
  'employeeDetail.configureKnowledge',
  'employeeDetail.configureSkills',
  'employeeDetail.configureBundledSkills',
];
const mockShowBaseList = jest.fn();
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
      updateResource={noop}
      showBaseList={mockShowBaseList}
    />
  );
}

describe('employee editor resource configuration entries', () => {
  beforeEach(() => mockShowBaseList.mockClear());

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
