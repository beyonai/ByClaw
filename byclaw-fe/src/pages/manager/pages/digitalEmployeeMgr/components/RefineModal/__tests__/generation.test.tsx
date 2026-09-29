import { Form } from 'antd';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RefineModal from '..';

jest.mock('@umijs/max', () => ({
  getLocale: () => 'zh-CN',
  useIntl: () => ({ formatMessage: ({ id }: any) => id }),
}));
jest.mock('@/utils/auth', () => ({
  getToken: () => '',
  getssoToken: () => '',
  getSessionKey: () => '',
  tokenKey: 'token',
  ssotokenKey: 'sso',
}));
jest.mock('@/utils/signature', () => ({ generateSignature: () => ({}) }));
// 保留真实 Form 注册、输入和勾选，隔离图标及非本次链路的其他编辑控件。
jest.mock('../Form', () => {
  const { Form, Input } = require('antd');
  return ({ form, promptConfigs, selectedSections, setSelectedSections }: any) => (
    <Form form={form}>
      <Form.Item name="resourceDesc">
        <Input aria-label="description" />
      </Form.Item>
      {promptConfigs.map((item: any) => (
        <div key={item.key}>
          <input
            type="checkbox"
            aria-label={`apply-${item.key}`}
            checked={selectedSections.has(`prompt:${item.key}`)}
            onChange={() =>
              setSelectedSections((prev: Set<string>) => {
                const next = new Set(prev);
                next.delete(`prompt:${item.key}`);
                return next;
              })
            }
          />
          <Form.Item name={['promptValues', item.key]}>
            <Input aria-label={item.name} />
          </Form.Item>
        </div>
      ))}
    </Form>
  );
});

const existing = [
  { key: 'agent', name: '工作规范', value: '原工作规范' },
  { key: 'memory', name: '记忆规范', value: '原记忆规范' },
  { key: 'custom', name: '教学要求', value: '原教学要求', tip: '保留提示' },
];
function Harness({ onOk }: any) {
  const [form] = Form.useForm();
  return (
    <>
      <Form
        form={form}
        initialValues={{
          resourceName: '语文老师',
          resourceDesc: '丰富教学经验',
          corePersonaDefinition: JSON.stringify(existing),
          coreCompetencies: [{ coreCompetency: '制定完整教学计划' }],
          tags: ['教学'],
          role: JSON.stringify({ retained: '保留', memory: '原记忆规范' }),
        }}
      />
      <RefineModal
        visible
        onOk={onOk}
        onCancel={jest.fn()}
        form={form}
        questionList={[]}
        modelCode="selected-model"
        agentType="001"
      />
    </>
  );
}

function response(events: string) {
  const bytes = new TextEncoder().encode(events);
  const read = jest
    .fn()
    .mockResolvedValueOnce({ value: bytes.slice(0, 31), done: false })
    .mockResolvedValueOnce({ value: bytes.slice(31), done: false })
    .mockResolvedValue({ done: true });
  return { ok: true, body: { getReader: () => ({ read }) } };
}

describe('generation stream and page field contract', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('sends unregistered page fields and applies only selected dynamic prompts', async () => {
    const fields = {
      agentDescription: '生成描述',
      coreCompetencies: '[{"coreCompetency":"制定完整教学计划"}]',
      corePersonaDefinition: JSON.stringify(existing.map((item) => ({ ...item, value: `生成-${item.key}` }))),
      agentTags: '["教学"]',
      commonQuestions: '[]',
    };
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        response(`event: finalFields\ndata: ${JSON.stringify(fields)}\n\nevent: done\ndata: [DONE]\n\n`)
      );
    const onOk = jest.fn();
    render(<Harness onOk={onOk} />);
    await screen.findByDisplayValue('生成-custom', {}, { timeout: 10000 });
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(JSON.parse(body.corePersonaDefinition)).toEqual(existing);
    expect(JSON.parse(body.coreCompetencies)[0].coreCompetency).toBe('制定完整教学计划');
    expect(body.modelCode).toBe('selected-model');
    fireEvent.change(screen.getByLabelText('教学要求'), { target: { value: '编辑后的教学要求' } });
    fireEvent.click(screen.getByLabelText('apply-memory'));
    fireEvent.click(screen.getByRole('button', { name: 'common.use' }));
    await waitFor(() => expect(onOk).toHaveBeenCalled());
    const result = onOk.mock.calls[0][0];
    expect(JSON.parse(result.corePersonaDefinition)).toEqual([
      { ...existing[0], value: '生成-agent' },
      existing[1],
      { ...existing[2], value: '编辑后的教学要求' },
    ]);
    expect(JSON.parse(result.role)).toMatchObject({
      retained: '保留',
      memory: '原记忆规范',
      custom: '编辑后的教学要求',
    });
    expect(result.coreCompetencies[0].coreCompetency).toBe('制定完整教学计划');
  });

  it('preserves page values when the server sends an error instead of generated fields', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        response(
          'event: start\ndata: {}\n\nevent: error\ndata: {"code":"MODEL_NOT_AVAILABLE","diagnosticId":"test-id"}\n\n'
        )
      );
    const onOk = jest.fn();
    render(<Harness onOk={onOk} />);
    await screen.findByText('refineModal.modelUnavailable (test-id)', {}, { timeout: 10000 });
    expect(screen.getByLabelText('教学要求')).toHaveValue('原教学要求');
    fireEvent.click(screen.getByRole('button', { name: 'common.use' }));
    await waitFor(() => expect(onOk).toHaveBeenCalled());
    expect(JSON.parse(onOk.mock.calls[0][0].corePersonaDefinition)).toEqual(existing);
    expect(onOk.mock.calls[0][0].coreCompetencies[0].coreCompetency).toBe('制定完整教学计划');
  });
});
