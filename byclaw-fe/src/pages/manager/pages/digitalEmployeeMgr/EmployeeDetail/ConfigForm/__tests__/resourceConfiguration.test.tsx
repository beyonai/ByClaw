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
  const messages = jest.requireActual('../../../locales/zh-CN').default;
  const commonMessages = jest.requireActual('@/locales/zh-CN').default;
  const intl = {
    // 添加操作及归属筛选使用真实中文文案，其他消息仍返回 ID，保持既有用例的定位方式。
    formatMessage: ({ id }: { id: string }) =>
      [
        'employeeDetail.addBundledSkill',
        'common.belong',
        'common.all',
        'resource.createdByMe',
        'resource.authorizedToMe',
      ].includes(id)
        ? messages[id] || commonMessages[id]
        : id,
  };
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
// 弹窗可见性单独等待最多 5 秒，其他接口或状态断言仍使用默认超时。
jest.setTimeout(15000);
// 日志中全量运行已使这两个多步表单用例超过 15 秒；为它们单独扩大总预算。
const multiStepFormTimeout = 30000;

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

function Editor({ employee, canConfigureResources, agentType = '001', scrollWithPage = false }: any) {
  const [form] = Form.useForm();
  editorForm = form;
  return (
    <ConfigForm
      agentId="employee-1"
      agentType={agentType}
      employeeType={agentType}
      ownerType={employee.ownerType}
      scrollWithPage={scrollWithPage}
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
      imageModelSelect={<span>Image model selector</span>}
      ttsModelSelect={<span>TTS model selector</span>}
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

  it('hides extra model selectors and their toggle while preserving saved model values', async () => {
    const employee = { ownerType: 'personal', resourceCode: 'alice_helper' };
    const { rerender } = render(<Editor employee={employee} />);
    await waitFor(() => expect(screen.getByText('employeeDetail.basicSettings')).toBeVisible());

    // 隐藏配置入口不应清空详情回填的模型，后续保存仍需保留原值。
    const savedModels = { imageModelId: '112219541234567890', ttsModelId: '112219541234567891' };
    act(() => editorForm.setFieldsValue(savedModels));
    rerender(<Editor employee={employee} />);

    expect(screen.getByText('employeeDetail.qaModel')).toBeVisible();
    expect(screen.queryByText('Image model selector')).not.toBeInTheDocument();
    expect(screen.queryByText('TTS model selector')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'employeeDetail.moreModels' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'employeeDetail.collapseMoreModels' })).not.toBeInTheDocument();
    expect(editorForm.getFieldValue('imageModelId')).toBe(savedModels.imageModelId);
    expect(editorForm.getFieldValue('ttsModelId')).toBe(savedModels.ttsModelId);
  });

  it('allows page scrolling only when requested and retains the ordinary editor height constraints', async () => {
    const employee = { ownerType: 'personal', resourceCode: 'alice_helper' };
    const { container, rerender } = render(<Editor employee={employee} scrollWithPage />);
    await screen.findByText('employeeDetail.basicSettings');
    expect(container.querySelector('.pageScroll')).toBeInTheDocument();
    expect(container.querySelector('form')).not.toHaveClass('full-height');
    expect(container.querySelector('.basicSettings')).not.toHaveClass('full-height');
    expect(container.querySelector('.configurationDetails')).not.toHaveClass('full-height');
    rerender(<Editor employee={employee} />);
    expect(container.querySelector('.pageScroll')).not.toBeInTheDocument();
    expect(container.querySelector('form')).toHaveClass('full-height');
    expect(container.querySelector('.basicSettings')).toHaveClass('full-height');
    expect(container.querySelector('.configurationDetails')).toHaveClass('full-height');
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
  ])(
    'keeps all resource entries usable for an ordinary assistant: %j',
    async (employee) => {
      render(<Editor employee={employee} />);
      await waitFor(() => expect(screen.getByText('employeeDetail.robotConfig.title')).toBeVisible());
      labels.forEach((label) => expect(screen.getByText(label)).toBeVisible());

      fireEvent.click(within(screen.getByText(labels[0]).parentElement!).getByRole('button'));
      expect(mockShowBaseList).toHaveBeenLastCalledWith('006');
      fireEvent.click(within(screen.getByText(labels[1]).parentElement!).getByRole('button'));
      expect(mockShowBaseList).toHaveBeenLastCalledWith('005');
      fireEvent.click(within(screen.getByText(labels[2]).parentElement!).getByRole('button'));
      await waitFor(() => expect(screen.getByRole('dialog', { hidden: true })).toBeVisible(), { timeout: 5000 });
    },
    multiStepFormTimeout
  );

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
    await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible(), { timeout: 5000 });

    rerender(<Editor employee={{ ownerType: 'personal', resourceCode: 'alice_main' }} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 5000 });
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

  it('labels an existing skill action as 添加 and allows adding and removing it', async () => {
    listSkills.mockResolvedValue({
      list: [{ resourceId: '103', resourceCode: 'search', resourceName: 'Search skill' }],
      total: 1,
    });
    render(<Editor employee={{ ownerType: 'enterprise', resourceCode: 'helper' }} />);
    openSkills();
    const dialog = within(await screen.findByRole('dialog'));
    const addButton = await dialog.findByRole('button', { name: /^添\s*加$/ });
    expect(dialog.queryByRole('button', { name: /^新\s*增$/ })).not.toBeInTheDocument();
    fireEvent.click(addButton);
    expect(editorForm.getFieldValue('bundledSkills')).toEqual(
      expect.arrayContaining([expect.objectContaining({ resourceId: '103' })])
    );
    fireEvent.click(await dialog.findByRole('button', { name: 'itemCard.remove' }));
    expect(editorForm.getFieldValue('bundledSkills')).toEqual([]);
    expect(dialog.getByRole('button', { name: /^添\s*加$/ })).toBeVisible();
  });

  it.each(['personal', 'enterprise'])('shows the allowed tabs and queries the initial %s scope', async (ownerType) => {
    // 人数相同的技能也沿用后端顺序，前端不按名称重新排序。
    listSkills.mockResolvedValue({
      list: [
        { resourceId: '301', resourceCode: 'popular-z', resourceName: 'Popular Z', useCount: 12 },
        { resourceId: '302', resourceCode: 'popular-a', resourceName: 'Popular A', useCount: 12 },
        { resourceId: '303', resourceCode: 'unused', resourceName: 'Unused skill', useCount: 0 },
      ],
      total: 3,
    });
    render(<Editor employee={{ ownerType, resourceCode: 'helper' }} />);
    openSkills();
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByRole('tab', { name: enterpriseTab })).toBeVisible();
    if (ownerType === 'personal') {
      expect(dialog.getByRole('tab', { name: personalTab })).toHaveAttribute('aria-selected', 'true');
      expect(dialog.queryByRole('group', { name: '归属' })).not.toBeInTheDocument();
    } else {
      expect(dialog.queryByRole('tab', { name: personalTab })).not.toBeInTheDocument();
      expect(dialog.getByRole('tab', { name: enterpriseTab })).toHaveAttribute('aria-selected', 'true');
      const filters = dialog.getByRole('group', { name: '归属' });
      // 使用真实 Tabs DOM 确认筛选在标签行的右侧插槽中，避免另起一行。
      const tabBar = filters.closest('.ant-tabs-nav')!;
      expect(within(tabBar as HTMLElement).getByRole('tab', { name: enterpriseTab })).toBeVisible();
      expect(filters.closest('.ant-tabs-extra-content')).not.toBeNull();
      expect(
        within(filters)
          .getAllByRole('button')
          .map((button) => button.textContent)
      ).toEqual(['全部', '我创建的', '授权给我的']);
    }
    await waitFor(() =>
      expect(listSkills).toHaveBeenLastCalledWith({
        resourceBizTypeList: ['SKILL'],
        ownerType,
        availableOnly: true,
        sortByUseCount: true,
        ...(ownerType === 'personal' ? { permission: 'CREATED_BY_ME' } : {}),
        pageNum: 1,
        pageSize: 30,
        keyword: '',
      })
    );
    await dialog.findByText('Popular Z');
    expect(dialog.getAllByText(/^(Popular Z|Popular A|Unused skill)$/).map((item) => item.textContent)).toEqual([
      'Popular Z',
      'Popular A',
      'Unused skill',
    ]);
  });

  it(
    'keeps personal skills restricted to the current creator during search and pagination',
    async () => {
      const makeSkill = (index: number) => ({
        resourceId: String(300 + index),
        resourceCode: `personal-${index}`,
        resourceName: `Personal skill ${index}`,
      });
      listSkills.mockImplementation(({ keyword, pageNum }) =>
        Promise.resolve({
          list: !keyword
            ? []
            : pageNum === 1
            ? Array.from({ length: 30 }, (_, index) => makeSkill(index + 1))
            : [makeSkill(31)],
          pageNum,
          pageSize: 30,
          total: keyword ? 31 : 0,
        })
      );
      const scrollHeight = jest.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
      const clientHeight = jest.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(100);
      try {
        render(<Editor employee={{ ownerType: 'personal', resourceCode: 'helper' }} />);
        openSkills();
        const dialog = within(await screen.findByRole('dialog'));
        await waitFor(() => expect(listSkills).toHaveBeenCalled());
        const input = dialog.getByPlaceholderText('employeeDetail.bundledSkillsSearchPlaceholder');
        fireEvent.change(input, { target: { value: 'personal' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });
        await dialog.findByText('Personal skill 1');
        const list = screen.getByRole('dialog').querySelector('.bundledSkillCardList')!;
        Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 900 });
        fireEvent.scroll(list);
        await dialog.findByText('Personal skill 31');
        expect(listSkills).toHaveBeenLastCalledWith({
          resourceBizTypeList: ['SKILL'],
          ownerType: 'personal',
          availableOnly: true,
          sortByUseCount: true,
          permission: 'CREATED_BY_ME',
          keyword: 'personal',
          pageNum: 2,
          pageSize: 30,
        });
        expect(dialog.getByText('Personal skill 1')).toBeVisible();
        expect(dialog.queryByRole('group', { name: '归属' })).not.toBeInTheDocument();
        listSkills.mock.calls.forEach(([request]) => {
          expect(request).toEqual(
            expect.objectContaining({
              ownerType: 'personal',
              availableOnly: true,
              sortByUseCount: true,
              permission: 'CREATED_BY_ME',
            })
          );
        });
      } finally {
        scrollHeight.mockRestore();
        clientHeight.mockRestore();
      }
    },
    multiStepFormTimeout
  );

  it.each([
    ['CREATED_BY_ME', '我创建的', 'My skill'],
    ['AUTHORIZED_TO_ME', '授权给我的', 'Authorized skill'],
  ])(
    'filters enterprise skills with %s while retaining search and selected skills',
    async (permission, filterLabel, resultName) => {
      const ownerType = 'enterprise';
      listSkills.mockImplementation(({ permission: requestedPermission }) =>
        Promise.resolve({
          list: [
            {
              resourceId: requestedPermission ? '202' : '201',
              resourceCode: requestedPermission ? 'filtered' : 'other',
              resourceName: requestedPermission ? resultName : 'Other skill',
            },
          ],
          total: 1,
        })
      );
      render(<Editor employee={{ ownerType, resourceCode: 'helper' }} />);
      openSkills();
      const dialog = within(await screen.findByRole('dialog'));
      await dialog.findByText('Other skill');
      const filters = within(dialog.getByRole('group', { name: '归属' }));
      expect(filters.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');
      act(() => editorForm.setFieldsValue({ bundledSkills: skills }));
      const input = dialog.getByPlaceholderText('employeeDetail.bundledSkillsSearchPlaceholder');
      fireEvent.change(input, { target: { value: 'search' } });
      fireEvent.click(filters.getByRole('button', { name: filterLabel }));

      await dialog.findByText(resultName);
      expect(listSkills).toHaveBeenLastCalledWith({
        resourceBizTypeList: ['SKILL'],
        ownerType,
        availableOnly: true,
        sortByUseCount: true,
        permission,
        keyword: 'search',
        pageNum: 1,
        pageSize: 30,
      });
      expect(input).toHaveValue('search');
      expect(dialog.queryByText('Other skill')).not.toBeInTheDocument();
      expect(filters.getByRole('button', { name: filterLabel })).toHaveAttribute('aria-pressed', 'true');
      expect(editorForm.getFieldValue('bundledSkills')).toEqual(
        expect.arrayContaining([expect.objectContaining({ resourceId: '103' })])
      );

      // 搜索提交和清空搜索都必须保留归属条件及可用资源范围。
      fireEvent.change(input, { target: { value: 'weather' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });
      await waitFor(() =>
        expect(listSkills).toHaveBeenLastCalledWith(
          expect.objectContaining({
            availableOnly: true,
            sortByUseCount: true,
            permission,
            keyword: 'weather',
            pageNum: 1,
          })
        )
      );
      fireEvent.change(input, { target: { value: '' } });
      await waitFor(() =>
        expect(listSkills).toHaveBeenLastCalledWith(
          expect.objectContaining({ availableOnly: true, sortByUseCount: true, permission, keyword: '', pageNum: 1 })
        )
      );
      fireEvent.click(filters.getByRole('button', { name: '全部' }));
      await dialog.findByText('Other skill');
      expect(listSkills).toHaveBeenLastCalledWith({
        resourceBizTypeList: ['SKILL'],
        ownerType,
        availableOnly: true,
        sortByUseCount: true,
        keyword: '',
        pageNum: 1,
        pageSize: 30,
      });
      expect(editorForm.getFieldValue('bundledSkills')).toEqual(
        expect.arrayContaining([expect.objectContaining({ resourceId: '103' })])
      );
    },
    multiStepFormTimeout
  );

  it.each([
    ['CREATED_BY_ME', '我创建的'],
    ['AUTHORIZED_TO_ME', '授权给我的'],
  ])(
    'restarts pagination when filtering and keeps %s on subsequent pages',
    async (permission, filterLabel) => {
      const makeSkill = (resourceId: number) => ({
        resourceId: String(resourceId),
        resourceCode: `skill-${resourceId}`,
        resourceName: `Skill ${resourceId}`,
      });
      listSkills.mockImplementation(({ permission: requestedPermission, pageNum }) => {
        const start = requestedPermission ? 201 : 101;
        return Promise.resolve({
          list:
            pageNum === 1
              ? Array.from({ length: 30 }, (_, index) => makeSkill(start + index))
              : [makeSkill(start + 30)],
          pageNum,
          pageSize: 30,
          total: 31,
        });
      });
      // JSDOM 不计算布局，模拟有滚动条的列表，避免首屏自动补页影响触底测试。
      const scrollHeight = jest.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
      const clientHeight = jest.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(100);
      try {
        render(<Editor employee={{ ownerType: 'enterprise', resourceCode: 'helper' }} />);
        openSkills();
        const dialog = within(await screen.findByRole('dialog'));
        await dialog.findByText('Skill 101');
        const scrollToBottom = () => {
          const list = screen.getByRole('dialog').querySelector('.bundledSkillCardList')!;
          Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 900 });
          fireEvent.scroll(list);
        };
        scrollToBottom();
        await dialog.findByText('Skill 131');

        fireEvent.click(within(dialog.getByRole('group', { name: '归属' })).getByRole('button', { name: filterLabel }));
        await dialog.findByText('Skill 201');
        expect(listSkills).toHaveBeenLastCalledWith(
          expect.objectContaining({
            availableOnly: true,
            sortByUseCount: true,
            permission,
            ownerType: 'enterprise',
            pageNum: 1,
            pageSize: 30,
          })
        );
        expect(dialog.queryByText('Skill 101')).not.toBeInTheDocument();
        expect(dialog.queryByText('Skill 131')).not.toBeInTheDocument();
        scrollToBottom();
        await dialog.findByText('Skill 231');
        expect(listSkills).toHaveBeenLastCalledWith(
          expect.objectContaining({
            availableOnly: true,
            sortByUseCount: true,
            permission,
            ownerType: 'enterprise',
            pageNum: 2,
            pageSize: 30,
          })
        );
        expect(dialog.getByText('Skill 201')).toBeVisible();
      } finally {
        scrollHeight.mockRestore();
        clientHeight.mockRestore();
      }
    },
    multiStepFormTimeout
  );

  it('ignores an unfiltered response that arrives after selecting the creator filter', async () => {
    let resolveAll!: (value: any) => void;
    listSkills.mockImplementation(({ permission }) =>
      permission
        ? Promise.resolve({
            list: [{ resourceId: '202', resourceCode: 'mine', resourceName: 'My skill' }],
            total: 1,
          })
        : new Promise((resolve) => {
            resolveAll = resolve;
          })
    );
    render(<Editor employee={{ ownerType: 'enterprise', resourceCode: 'helper' }} />);
    openSkills();
    const dialog = within(await screen.findByRole('dialog'));
    await waitFor(() => expect(resolveAll).toBeDefined());
    fireEvent.click(within(dialog.getByRole('group', { name: '归属' })).getByRole('button', { name: '我创建的' }));
    await dialog.findByText('My skill');
    await act(async () =>
      resolveAll({
        list: [{ resourceId: '201', resourceCode: 'other', resourceName: 'Stale result' }],
        total: 1,
      })
    );
    expect(dialog.queryByText('Stale result')).not.toBeInTheDocument();
    expect(dialog.getByText('My skill')).toBeVisible();
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
          availableOnly: true,
          sortByUseCount: true,
          permission: 'CREATED_BY_ME',
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
          availableOnly: true,
          sortByUseCount: true,
          keyword: '',
          pageNum: 1,
        })
      )
    );
    expect(input).toHaveValue('');
    expect(listSkills.mock.calls[listSkills.mock.calls.length - 1][0]).not.toHaveProperty('permission');
    expect(within(dialog.getByRole('group', { name: '归属' })).getByRole('button', { name: '全部' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(editorForm.getFieldValue('bundledSkills')).toEqual(
      expect.arrayContaining([expect.objectContaining({ resourceId: '103' })])
    );
    fireEvent.click(within(dialog.getByRole('group', { name: '归属' })).getByRole('button', { name: '授权给我的' }));
    await waitFor(() =>
      expect(listSkills).toHaveBeenLastCalledWith(
        expect.objectContaining({
          availableOnly: true,
          sortByUseCount: true,
          permission: 'AUTHORIZED_TO_ME',
          ownerType: 'enterprise',
        })
      )
    );
    fireEvent.click(dialog.getByRole('tab', { name: personalTab }));
    await waitFor(() =>
      expect(listSkills).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ownerType: 'personal',
          availableOnly: true,
          sortByUseCount: true,
          permission: 'CREATED_BY_ME',
          keyword: '',
          pageNum: 1,
        })
      )
    );
    expect(dialog.queryByRole('group', { name: '归属' })).not.toBeInTheDocument();
  });

  it('restores all skills and clears search when reopening the dialog', async () => {
    render(<Editor employee={{ ownerType: 'enterprise', resourceCode: 'helper' }} />);
    openSkills();
    let dialog = within(await screen.findByRole('dialog'));
    const input = dialog.getByPlaceholderText('employeeDetail.bundledSkillsSearchPlaceholder');
    fireEvent.change(input, { target: { value: 'search' } });
    fireEvent.click(within(dialog.getByRole('group', { name: '归属' })).getByRole('button', { name: '我创建的' }));
    await waitFor(() =>
      expect(listSkills).toHaveBeenLastCalledWith(
        expect.objectContaining({ permission: 'CREATED_BY_ME', keyword: 'search' })
      )
    );
    fireEvent.click(dialog.getByRole('button', { name: 'icon-a-Closeguanbi' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    openSkills();
    dialog = within(await screen.findByRole('dialog'));
    await waitFor(() =>
      expect(listSkills).toHaveBeenLastCalledWith({
        resourceBizTypeList: ['SKILL'],
        ownerType: 'enterprise',
        availableOnly: true,
        sortByUseCount: true,
        keyword: '',
        pageNum: 1,
        pageSize: 30,
      })
    );
    expect(dialog.getByPlaceholderText('employeeDetail.bundledSkillsSearchPlaceholder')).toHaveValue('');
    expect(within(dialog.getByRole('group', { name: '归属' })).getByRole('button', { name: '全部' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it(
    'ignores a personal response that arrives after switching to enterprise',
    async () => {
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
    },
    multiStepFormTimeout
  );

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
