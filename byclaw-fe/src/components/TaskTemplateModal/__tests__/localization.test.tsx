import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import TaskTemplateModal from '..';
import { taskTemplateOptionLabel } from '../optionLabels';
import { getOperationTaskTemplate, listOperationTaskTemplates } from '@/service/devloop';

let mockLocale = 'zh-CN';
jest.mock('@umijs/max', () => ({
  getIntl: () => jest.requireActual('@/testUtils/localeIntl').getLocaleIntl(mockLocale),
  useIntl: () => jest.requireActual('@/testUtils/localeIntl').getLocaleIntl(mockLocale),
}));
jest.mock('@/service/devloop', () => ({ getOperationTaskTemplate: jest.fn(), listOperationTaskTemplates: jest.fn() }));
jest.mock('@/service/knowledgeCenter', () => ({ queryAuthDoc: jest.fn() }));

it('updates template UI labels while keeping the loaded task configuration intact', async () => {
  mockLocale = 'zh-CN';
  const template = {
    templateId: '9007199254740993',
    templateType: 'content',
    templateName: '业务模板',
    config: {
      title: '用户任务',
      description: '用户要求',
      contentType: '公众号文章',
      executorType: 'agent',
      agentId: '9007199254740995',
      runMode: 'once',
    },
  };
  (listOperationTaskTemplates as jest.Mock).mockResolvedValue([template]);
  (getOperationTaskTemplate as jest.Mock).mockResolvedValue(template);
  const props = {
    open: true,
    onCancel: jest.fn(),
    onApply: jest.fn(),
    knowledgeOptionsOnly: true,
    agentOptionsOnly: true,
    agentOptions: [{ label: '业务员工', value: '9007199254740995' }],
  };
  const view = () => (
    <ConfigProvider theme={{ token: { motion: false } }}>
      <TaskTemplateModal {...props} />
    </ConfigProvider>
  );
  const { rerender } = render(view());
  fireEvent.click(await screen.findByText('业务模板'));
  expect(await screen.findByDisplayValue('用户任务')).toBeInTheDocument();
  mockLocale = 'en-US';
  rerender(view());
  expect(screen.getByText('Execution configuration')).toBeInTheDocument();
  expect(screen.getByDisplayValue('用户任务')).toBeInTheDocument();
  expect(screen.getByText('WeChat article')).toBeInTheDocument();
  expect(taskTemplateOptionLabel('公众号文章')).toBe('WeChat article');
  expect(taskTemplateOptionLabel('自定义内容')).toBe('自定义内容');
  // 保存时仍提交原始枚举、大整数 ID 和用户输入；生成到输入框的提示按当前语言展示。
  await waitFor(() => expect(getOperationTaskTemplate).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Apply to message input' }));
  await waitFor(() =>
    expect(props.onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        values: expect.objectContaining({
          title: '用户任务',
          description: '用户要求',
          contentType: '公众号文章',
          agentId: '9007199254740995',
          executorType: 'agent',
          runMode: 'once',
        }),
        prompt: expect.stringContaining('Task name: 用户任务'),
      })
    )
  );
});

it('uses English defaults only for fields absent from the saved template', async () => {
  mockLocale = 'en-US';
  const template = { templateId: '1', templateType: 'content', templateName: '业务模板', config: {} };
  (listOperationTaskTemplates as jest.Mock).mockResolvedValue([template]);
  (getOperationTaskTemplate as jest.Mock).mockResolvedValue(template);
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <TaskTemplateModal open onCancel={jest.fn()} onApply={jest.fn()} knowledgeOptionsOnly agentOptionsOnly />
    </ConfigProvider>
  );
  fireEvent.click(await screen.findByText('业务模板'));
  expect(await screen.findByDisplayValue('Write a WeChat article for BeyondAI Lab')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Business leaders and AI product managers')).toBeInTheDocument();
});
