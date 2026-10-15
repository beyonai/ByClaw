import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ConfigProvider, Form } from 'antd';
import type { FormInstance } from 'antd';
import { useState } from 'react';
import ModelFormFields from '../ModelFormFields';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    locale: 'zh-CN',
    // 使用实际中文文案，校验适用场景字段对用户展示的名称。
    formatMessage: ({ id }: { id: string }) =>
      id === 'modelMgr.modal.applicabilityScope' ? jest.requireActual('@/locales/zh-CN/manager').default[id] : id,
  }),
}));

jest.mock('@/pages/manager/service/System', () => ({
  getByParamGroupCode: jest.fn().mockResolvedValue({ data: { byaiSystemConfigLists: [] } }),
}));

jest.mock('../ModelFormSection', () => ({ title, children }: any) => (
  <section aria-label={title}>{children}</section>
));

describe('ModelFormFields section placement', () => {
  it.each([
    ['modelMgr.modal.moreBasicSettings', 'modelMgr.modal.systemTags'],
    ['modelMgr.modal.advancedConnection', 'modelMgr.modal.headers'],
  ])('keeps the disclosure arrow and content in sync for %s', async (buttonName, contentLabel) => {
    const TestForm = () => {
      const [form] = Form.useForm();
      const [openSections, setOpenSections] = useState<string[]>([]);
      return (
        <ConfigProvider theme={{ token: { motion: false } }}>
          <ModelFormFields
            simplified
            form={form}
            modalTitle="model"
            systemOptions={[]}
            abilityOptions={[]}
            modelTypeOptions={[]}
            statusOptions={[]}
            tokenVisible={false}
            setTokenVisible={jest.fn()}
            isSectionOpen={(key) => openSections.includes(key)}
            toggleSection={(key) =>
              setOpenSections((keys) => (keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key]))
            }
            onValuesChange={jest.fn()}
          />
        </ConfigProvider>
      );
    };

    await act(async () => {
      render(<TestForm />);
    });
    const button = screen.getByRole('button', { name: buttonName });
    const content = screen.getByText(contentLabel);

    // 验证完整的展开、收起循环，避免箭头方向与实际内容显隐不同步。
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button.querySelector('[data-icon="right"]')).toBeInTheDocument();
    expect(content).not.toBeVisible();

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button.querySelector('[data-icon="down"]')).toBeInTheDocument();
    expect(content).toBeVisible();

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button.querySelector('[data-icon="right"]')).toBeInTheDocument();
    expect(content).not.toBeVisible();
  });

  it.each([{ systems: [] }, { systems: ['BY_CLAW'] }])('keeps system tags in basic configuration: %j', async ({ systems }) => {
    let form: FormInstance;
    const TestForm = () => {
      [form] = Form.useForm();
      return (
        <ConfigProvider theme={{ token: { motion: false } }}>
          <ModelFormFields
            form={form}
            modalTitle="model"
            systemOptions={[{ label: 'ByClaw', value: 'BY_CLAW' }]}
            abilityOptions={[]}
            modelTypeOptions={[]}
            statusOptions={[]}
            tokenVisible={false}
            setTokenVisible={jest.fn()}
            isSectionOpen={() => true}
            toggleSection={jest.fn()}
            onValuesChange={jest.fn()}
          />
        </ConfigProvider>
      );
    };

    await act(async () => {
      render(<TestForm />);
    });
    await act(async () => {
      form!.setFieldsValue({ systems });
    });

    // 系统标签只出现在首张基础配置卡片，应用范围和状态继续留在应用配置中。
    const sections = screen.getAllByRole('region');
    const basic = screen.getByRole('region', { name: 'modelMgr.modal.basicConfig' });
    const application = screen.getByRole('region', { name: 'modelMgr.modal.tagConfig' });
    expect(sections[0]).toBe(basic);
    expect(within(basic).getByLabelText('modelMgr.modal.systemTags')).toBeInTheDocument();
    expect(within(application).queryByLabelText('modelMgr.modal.systemTags')).not.toBeInTheDocument();
    expect(within(application).getByLabelText('modelMgr.modal.ability')).toBeInTheDocument();
    expect(within(application).getByLabelText('modelMgr.modal.status')).toBeInTheDocument();
    expect(form!.getFieldValue('systems')).toEqual(systems);

    const scopeInput = within(basic).getByLabelText('适用场景');
    expect(scopeInput.tagName).toBe('TEXTAREA');
    expect(
      within(basic).getByLabelText('modelMgr.modal.systemTags').compareDocumentPosition(scopeInput) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    await act(async () => {
      form!.setFieldsValue({ applicabilityScope: '适用于内部知识问答\n支持中文资料' });
    });
    expect(scopeInput).toHaveValue('适用于内部知识问答\n支持中文资料');
    fireEvent.change(scopeInput, { target: { value: '适用于代码生成' } });
    expect(form!.getFieldValue('applicabilityScope')).toBe('适用于代码生成');
    fireEvent.change(scopeInput, { target: { value: '' } });
    expect(form!.getFieldValue('applicabilityScope')).toBe('');
  });
});
