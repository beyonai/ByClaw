import { act, fireEvent, render as renderComponent, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider, message } from 'antd';
import {
  createManagedWorkgroupTemplate,
  deleteManagedWorkgroupTemplate,
  getWorkgroupTemplateCapability,
  listManagedWorkgroupTemplates,
  listWorkgroupTemplateCatalogs,
  updateManagedWorkgroupTemplate,
  type WorkgroupTemplate,
} from '../../../service/WorkgroupTemplate';
import WorkgroupTemplateMgr from '..';

let mockLanguage = 'zh-CN';

jest.mock('@umijs/max', () => {
  const messages: Record<string, Record<string, string>> = {
    'zh-CN': jest.requireActual('@/locales/zh-CN/manager').default,
    'en-US': jest.requireActual('@/locales/en-US/manager').default,
  };
  return {
    useSelector: (selector: (state: unknown) => unknown) => selector({ user: { userInfo: { userCode: 'adminvip' } } }),
    useIntl: () => ({ formatMessage: ({ id }: { id: string }) => messages[mockLanguage][id] || id }),
  };
});

jest.mock('antd', () => {
  const actual = jest.requireActual('antd');
  return {
    ...actual,
    // 保留真实表单和弹窗；关闭动画并简化目录下拉，集中验证保存行为。
    Modal: Object.assign(
      (props: import('antd').ModalProps) => <actual.Modal {...props} transitionName="" maskTransitionName="" />,
      actual.Modal
    ),
    TreeSelect: ({ id, value, treeData, onChange }: any) => (
      <select id={id} value={value || ''} onChange={(event) => onChange(event.target.value)}>
        <option value="">请选择资产目录</option>
        {treeData.map((item: any) => (
          <option key={item.value} value={item.value}>
            {item.title}
          </option>
        ))}
      </select>
    ),
    message: { ...actual.message, success: jest.fn(), error: jest.fn(), warning: jest.fn() },
  };
});

jest.mock('@/pages/manager/service/WorkgroupTemplate', () => ({
  createManagedWorkgroupTemplate: jest.fn(),
  updateManagedWorkgroupTemplate: jest.fn(),
  deleteManagedWorkgroupTemplate: jest.fn(),
  getWorkgroupTemplateCapability: jest.fn(),
  listManagedWorkgroupTemplates: jest.fn(),
  listWorkgroupTemplateCatalogs: jest.fn(),
}));
jest.mock('@/service/digitalEmployees', () => ({ getAllDigitalEmployeesV2: jest.fn() }));
jest.mock('@/pages/manager/pages/digitalEmployeeMgr/EmployeeDetail/EmployeeGroupMembers', () => ({ onChange }: any) => (
  <button type="button" onClick={() => onChange([{ id: '11055690', resourceId: '11055690', name: '测试员工' }])}>
    选择测试员工
  </button>
));

const storedTemplate: WorkgroupTemplate = {
  template: {
    templateId: '200',
    templateName: '测试模板',
    catalogId: '54',
    summary: '测试摘要',
    defaultGroupName: '测试工作组',
    defaultGoal: '测试目标',
    version: 3,
    status: 'ENABLED',
  },
  catalogName: '市场营销',
  resources: [{ resourceId: '11055690', resourceName: '测试员工', employees: [] }],
  employees: [],
};

// 保留真实表单校验，关闭表单反馈和表格动画，避免异步更新延续到下一步操作。
const render = (ui: Parameters<typeof renderComponent>[0]) =>
  renderComponent(ui, {
    wrapper: ({ children }) => <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>,
  });

const openNewTemplate = async (catalogId = '54') => {
  await act(async () => {
    render(<WorkgroupTemplateMgr />);
  });
  // 通过唯一文案定位入口，避免每次交互都计算整张 AntD 表格的可访问名称和可见性。
  const createButton = await screen.findByText('新建模板');
  await act(async () => {
    fireEvent.click(createButton);
  });
  // 弹窗挂载后仅查询表单区域，减少对背景表格的重复遍历和可见性计算。
  const dialogElement = await screen.findByRole('dialog', { hidden: true });
  expect(dialogElement).toBeVisible();
  const dialog = within(dialogElement);
  await dialog.findByText('市场营销', { selector: 'option' });
  await act(async () => {
    fireEvent.change(dialog.getByLabelText('模板名称'), { target: { value: '测试模板' } });
    fireEvent.change(dialog.getByLabelText('资产目录'), { target: { value: catalogId } });
    fireEvent.change(dialog.getByLabelText('模板摘要'), { target: { value: '测试摘要' } });
    fireEvent.change(dialog.getByLabelText('默认工作组名称'), { target: { value: '测试工作组' } });
    fireEvent.change(dialog.getByLabelText('默认工作目标'), { target: { value: '测试目标' } });
    fireEvent.click(dialog.getByText('选择测试员工'));
  });
  return dialog;
};

describe('workgroup template saving', () => {
  // 全量钩子中多步真实表单交互已超过默认 5 秒；仅扩大用例总预算，保留断言默认超时。
  jest.setTimeout(15000);

  beforeEach(() => {
    // 保留全局 matchMedia 等浏览器 mock 的实现，仅重置业务接口，清除上个用例的响应队列。
    jest.clearAllMocks();
    mockLanguage = 'zh-CN';
    jest.mocked(getWorkgroupTemplateCapability).mockReset().mockResolvedValue(true);
    jest.mocked(listManagedWorkgroupTemplates).mockReset().mockResolvedValue([]);
    jest
      .mocked(listWorkgroupTemplateCatalogs)
      .mockReset()
      .mockResolvedValue([
        { catalogId: 54, catalogName: '市场营销', pCatalogId: -1 },
        { catalogId: 0, catalogName: '其他领域', pCatalogId: -1 },
      ]);
    jest.mocked(createManagedWorkgroupTemplate).mockReset().mockResolvedValue(undefined);
    jest.mocked(updateManagedWorkgroupTemplate).mockReset().mockResolvedValue(undefined);
    jest.mocked(deleteManagedWorkgroupTemplate).mockReset().mockResolvedValue(undefined);
  });

  it.each([
    ['资产目录不存在或不可用', '资产目录不存在或不可用'],
    [{ response: { data: { msg: '资产目录不存在或不可用' } }, message: 'HTTP 404' }, '资产目录不存在或不可用'],
    [new Error('网络连接失败'), '网络连接失败'],
    [undefined, '模板保存失败'],
  ])('displays the returned save reason for %p and keeps the form for retry', async (error, expected) => {
    jest.mocked(createManagedWorkgroupTemplate).mockRejectedValueOnce(error);
    const dialog = await openNewTemplate();
    const saveButton = dialog.getByText('保存模板').closest('button')!;

    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => expect(message.error).toHaveBeenCalledWith(expected));
    expect(dialog.getByLabelText('模板名称')).toHaveValue('测试模板');
    expect(dialog.getByLabelText('资产目录')).toHaveValue('54');
    expect(message.success).not.toHaveBeenCalled();
    // 失败后取消 saving 状态，重试应再次提交同一份有效表单。
    await waitFor(() => expect(saveButton).not.toHaveClass('ant-btn-loading'));
    await act(async () => {
      fireEvent.click(saveButton);
    });
    await waitFor(() => expect(message.success).toHaveBeenCalledWith('模板保存成功'));
    expect(createManagedWorkgroupTemplate).toHaveBeenCalledTimes(2);
    expect(createManagedWorkgroupTemplate).toHaveBeenLastCalledWith(
      expect.objectContaining({ catalogId: '54', resourceIds: ['11055690'] })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('submits catalog ID zero and closes the dialog after saving', async () => {
    const dialog = await openNewTemplate('0');

    await act(async () => {
      fireEvent.click(dialog.getByText('保存模板'));
    });

    await waitFor(() => expect(message.success).toHaveBeenCalledWith('模板保存成功'));
    expect(createManagedWorkgroupTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ catalogId: '0', resourceIds: ['11055690'] })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('uses the localized fallback only when no server reason is available', async () => {
    mockLanguage = 'en-US';
    jest.mocked(createManagedWorkgroupTemplate).mockRejectedValue(undefined);
    const dialog = await openNewTemplate();

    await act(async () => {
      fireEvent.click(dialog.getByText('保存模板'));
    });

    await waitFor(() => expect(message.error).toHaveBeenCalledWith('Failed to save template'));
  });

  it('retains the update version and displays the server conflict reason', async () => {
    jest.mocked(listManagedWorkgroupTemplates).mockResolvedValue([storedTemplate]);
    jest.mocked(updateManagedWorkgroupTemplate).mockRejectedValue('工作组模板已被修改');
    await act(async () => {
      render(<WorkgroupTemplateMgr />);
    });
    const editButton = await screen.findByText('编辑');
    await act(async () => {
      fireEvent.click(editButton);
    });
    const dialog = within(await screen.findByRole('dialog', { hidden: true }));

    await act(async () => {
      fireEvent.click(dialog.getByText('保存模板'));
    });

    await waitFor(() => expect(message.error).toHaveBeenCalledWith('工作组模板已被修改'));
    expect(updateManagedWorkgroupTemplate).toHaveBeenCalledWith(
      '200',
      expect.objectContaining({ expectedVersion: 3, catalogId: '54', resourceIds: ['11055690'] })
    );
    expect(createManagedWorkgroupTemplate).not.toHaveBeenCalled();
    expect(dialog.getByLabelText('模板名称')).toHaveValue('测试模板');
  });

  it('reports refresh failure separately after a successful save', async () => {
    jest.mocked(listManagedWorkgroupTemplates).mockResolvedValueOnce([]).mockRejectedValueOnce('列表查询失败');
    const dialog = await openNewTemplate();

    await act(async () => {
      fireEvent.click(dialog.getByText('保存模板'));
    });

    await waitFor(() => expect(message.error).toHaveBeenCalledWith('列表查询失败'));
    expect(message.success).toHaveBeenCalledWith('模板保存成功');
    expect(message.error).not.toHaveBeenCalledWith('模板保存失败');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('displays the server deletion reason and retains the row on failure', async () => {
    jest.mocked(listManagedWorkgroupTemplates).mockResolvedValue([storedTemplate]);
    jest.mocked(deleteManagedWorkgroupTemplate).mockRejectedValue('工作组模板已被修改');
    render(<WorkgroupTemplateMgr />);
    fireEvent.click(await screen.findByRole('button', { name: /删\s*除/ }));
    const confirmation = await screen.findByText('确定删除这个工作组模板吗？');
    const popup = confirmation.closest('.ant-popover') as HTMLElement;

    fireEvent.click(within(popup).getByRole('button', { name: /删\s*除/ }));

    await waitFor(() => expect(message.error).toHaveBeenCalledWith('工作组模板已被修改'));
    expect(deleteManagedWorkgroupTemplate).toHaveBeenCalledWith('200', 3);
    expect(screen.getByText('测试模板')).toBeInTheDocument();
    expect(message.success).not.toHaveBeenCalled();
  });
});
