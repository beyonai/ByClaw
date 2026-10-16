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

jest.mock('../ModelFormSection', () => {
  const ModelFormSection = jest.requireActual('../ModelFormSection').default;
  return (props: any) => (
    <section aria-label={props.title}>
      <ModelFormSection {...props} />
    </section>
  );
});

describe('ModelFormFields section placement', () => {
  it.each(['BAILIAN_IMAGE', 'TOKENHUB_IMAGE'])(
    'does not offer MiniMax-only controls for the dedicated %s image protocol',
    async (modelProtocol) => {
      let form: FormInstance;
      const TestForm = () => {
        [form] = Form.useForm();
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
        form!.setFieldsValue({ modelType: 'IMAGE_GENERATION', modelProtocol });
      });
      expect(screen.getByLabelText('modelMgr.modal.imagePrompt')).toBeVisible();
      ['aspectRatio', 'imageCount', 'responseFormat', 'promptOptimizer'].forEach((field) => {
        expect(screen.queryByLabelText(`modelMgr.modal.${field}`)).not.toBeInTheDocument();
      });
    }
  );
  it.each([
    ['modelMgr.modal.moreBasicSettings', 'modelMgr.modal.systemTags'],
    ['modelMgr.modal.moreBasicSettings', 'modelMgr.modal.ability'],
    ['modelMgr.modal.moreBasicSettings', 'modelMgr.modal.status'],
    ['modelMgr.modal.moreConfig', 'modelMgr.modal.headers'],
    ['modelMgr.modal.moreConfig', 'modelMgr.modal.contextTokens'],
  ])('keeps the disclosure arrow and content in sync for %s', async (buttonName, contentLabel) => {
    const TestForm = () => {
      const [form] = Form.useForm();
      const [openSections, setOpenSections] = useState<string[]>(['basic']);
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
    expect(screen.getByLabelText('modelMgr.modal.apiToken')).toBeVisible();

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button.querySelector('[data-icon="down"]')).toBeInTheDocument();
    expect(content).toBeVisible();

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button.querySelector('[data-icon="right"]')).toBeInTheDocument();
    expect(content).not.toBeVisible();
    expect(screen.getByLabelText('modelMgr.modal.apiToken')).toBeVisible();
  });

  it.each([
    { simplified: true, systems: [] },
    { simplified: true, systems: ['BY_CLAW'] },
    { simplified: false, systems: [] },
    { simplified: false, systems: ['BY_CLAW'] },
  ])('groups credentials and application fields in basic configuration: %j', async ({ simplified, systems }) => {
    let form: FormInstance;
    const TestForm = () => {
      [form] = Form.useForm();
      return (
        <ConfigProvider theme={{ token: { motion: false } }}>
          <ModelFormFields
            simplified={simplified}
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

    // 新增和编辑共用两组字段布局，凭证和应用字段只在基础配置注册一次。
    const sections = screen.getAllByRole('region');
    const basic = screen.getByRole('region', { name: 'modelMgr.modal.basicConfig' });
    const more = screen.getByRole('region', { name: 'modelMgr.modal.moreConfig' });
    expect(sections).toEqual([basic, more]);
    ['systemTags', 'apiToken', 'ability', 'status'].forEach((field) => {
      expect(within(basic).getByLabelText(`modelMgr.modal.${field}`).closest('.ant-form-item')).toBeVisible();
      expect(screen.getAllByLabelText(`modelMgr.modal.${field}`)).toHaveLength(1);
      expect(within(more).queryByLabelText(`modelMgr.modal.${field}`)).not.toBeInTheDocument();
    });
    ['modelProtocol', 'apiEndpoint', 'connectTimeoutSec', 'contextTokens', 'temperature'].forEach((field) => {
      expect(within(more).getByLabelText(`modelMgr.modal.${field}`).closest('.ant-form-item')).toBeVisible();
      expect(within(basic).queryByLabelText(`modelMgr.modal.${field}`)).not.toBeInTheDocument();
    });
    expect(within(more).getByText('modelMgr.modal.headers')).toBeVisible();
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
