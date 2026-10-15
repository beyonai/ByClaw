import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ConfigProvider, Form } from 'antd';
import type { FormInstance } from 'antd';
import ModelFormFields from '../ModelFormFields';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ locale: 'zh-CN', formatMessage: ({ id }: { id: string }) => id }),
}));

jest.mock('@/pages/manager/service/System', () => ({
  getByParamGroupCode: jest.fn().mockResolvedValue({ data: { byaiSystemConfigLists: [] } }),
}));

jest.mock('../ModelFormSection', () => ({ title, children }: any) => (
  <section aria-label={title}>{children}</section>
));

describe('ModelFormFields section placement', () => {
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

    const scopeInput = within(basic).getByLabelText('modelMgr.modal.applicabilityScope');
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
