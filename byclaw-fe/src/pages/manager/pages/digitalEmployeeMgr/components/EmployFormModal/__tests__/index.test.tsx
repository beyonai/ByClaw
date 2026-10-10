import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { history } from '@umijs/max';
import { getDcSystemConfigListByStandType } from '@/pages/manager/service/DigitalEmployeeMgr';
import EmployFormModal from '../index';

const mockIntl = { formatMessage: ({ id }: { id: string }) => id };
const mockDispatch = jest.fn();
let mockLocale = 'zh-CN';
const mockDigitalTypeOpts = [
  { value: 'FROM_MANUALLY', label: '手动创建' },
  { value: 'FROM_THIRD', label: '从第三方添加' },
];
const assistant = { paramValue: '001', paramName: '助手', paramEnName: 'Assistant' };
const qa = { paramValue: '006', paramName: '问答', paramEnName: 'QA' };

jest.mock('@umijs/max', () => ({
  connect: () => (component: any) => component,
  history: { push: jest.fn() },
  useDispatch: () => mockDispatch,
  useIntl: () => mockIntl,
  getLocale: () => mockLocale,
}));

jest.mock('../useDigitalTypeOptions', () => ({
  useDigitalTypeOptions: () => ({ digitalTypeOpts: mockDigitalTypeOpts }),
}));

jest.mock('@/pages/manager/service/DigitalEmployeeMgr', () => ({
  getDcSystemConfigListByStandType: jest.fn(),
  getSourceOption: jest.fn().mockResolvedValue({ success: true, data: [] }),
}));

// 保留真实 AntD 表单与单选项，隔离弹窗动画及创建方式卡片的图标依赖。
jest.mock('@/pages/manager/components/ModalDrawer', () => ({
  __esModule: true,
  default: ({ open, children, onOk, onCancel }: any) =>
    open ? (
      <div>
        {children}
        <button type="button" onClick={onOk}>
          确定
        </button>
        <button type="button" onClick={onCancel}>
          取消
        </button>
      </div>
    ) : null,
}));

jest.mock('@/pages/manager/components/CardRadio', () => ({
  __esModule: true,
  default: ({ options, value, onChange }: any) => (
    <div>
      {options.map((option: any) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
}));

jest.mock('../SandboxCardRadio', () => () => null);

const renderForm = async (data?: any) => {
  const view = render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <EmployFormModal open type="add" onCancel={jest.fn()} data={data} />
    </ConfigProvider>
  );
  await act(async () => {});
  return view;
};

const submitForm = async () => {
  fireEvent.change(screen.getByPlaceholderText('employFormModal.namePlaceholder'), {
    target: { value: '企业助手' },
  });
  fireEvent.change(screen.getByPlaceholderText('employFormModal.descriptionPlaceholder'), {
    target: { value: '企业助手描述' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
  });
  await waitFor(() => expect(history.push).toHaveBeenCalledTimes(1));
  return (history.push as jest.Mock).mock.calls[0][0];
};

describe('enterprise employee creation type selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    mockLocale = 'zh-CN';
  });

  it.each([
    { options: [assistant] },
    {
      options: [assistant, { paramValue: '005', paramName: '问数' }, { paramValue: '017', paramName: '数字员工组' }],
    },
  ])('hides a single available type and passes its value after filtering: %p', async ({ options }) => {
    (getDcSystemConfigListByStandType as jest.Mock).mockResolvedValue({ data: options });
    await renderForm();

    expect(screen.getByText('employFormModal.employeeType')).not.toBeVisible();
    expect(screen.queryByRole('radio')).toBeNull();
    const route = await submitForm();
    expect(route.pathname).toBe('/digitalEmployeesCreate');
    expect(new URLSearchParams(route.search).get('agentType')).toBe('001');
    expect(new URLSearchParams(route.search).get('ownerType')).toBe('enterprise');
    expect(route.state.agentType).toBe('001');
  });

  it('replaces a stale type with the only available option', async () => {
    (getDcSystemConfigListByStandType as jest.Mock).mockResolvedValue({ data: [assistant, qa] });
    const view = await renderForm();
    fireEvent.click(screen.getByRole('radio', { name: '问答' }));

    // 语言变化会重新加载类型配置，模拟可选类型从两种收敛为一种。
    (getDcSystemConfigListByStandType as jest.Mock).mockResolvedValue({ data: [assistant] });
    mockLocale = 'en-US';
    await act(async () => {
      view.rerender(
        <ConfigProvider theme={{ token: { motion: false } }}>
          <EmployFormModal open type="add" onCancel={jest.fn()} />
        </ConfigProvider>
      );
    });
    expect(screen.getByText('employFormModal.employeeType')).not.toBeVisible();

    const route = await submitForm();
    expect(new URLSearchParams(route.search).get('agentType')).toBe('001');
    expect(route.state.agentType).toBe('001');
  });

  it('shows two types, defaults to the first and passes the selected type', async () => {
    (getDcSystemConfigListByStandType as jest.Mock).mockResolvedValue({ data: [assistant, qa] });
    await renderForm();

    expect(screen.getByText('employFormModal.employeeType')).toBeVisible();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByRole('radio', { name: '助手' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: '问答' }));
    const route = await submitForm();
    expect(new URLSearchParams(route.search).get('agentType')).toBe('006');
    expect(route.state.agentType).toBe('006');
  });

  it('shows three or more available types', async () => {
    (getDcSystemConfigListByStandType as jest.Mock).mockResolvedValue({
      data: [assistant, qa, { paramValue: '010', paramName: '调试', paramEnName: 'Debug' }],
    });
    await renderForm();

    expect(screen.getByText('employFormModal.employeeType')).toBeVisible();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('only shows type selection for manual creation', async () => {
    (getDcSystemConfigListByStandType as jest.Mock).mockResolvedValue({ data: [assistant, qa] });
    await renderForm();

    fireEvent.click(screen.getByRole('button', { name: '从第三方添加' }));
    expect(screen.queryByText('employFormModal.employeeType')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '手动创建' }));
    expect(screen.getByText('employFormModal.employeeType')).toBeVisible();
    expect(screen.getByRole('radio', { name: '助手' })).toBeChecked();
  });
});
