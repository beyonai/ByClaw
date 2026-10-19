import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Button, ConfigProvider, Form } from 'antd';
import CredentialFields from '../CredentialFields';

const fields = [
  { key: 'email', label: '邮箱地址', inputType: 'text' as const, maxLength: 256 },
  { key: 'authCode', label: '应用专用密码', inputType: 'password' as const, maxLength: 2048 },
  { key: 'imapHost', label: 'IMAP 地址', inputType: 'text' as const, maxLength: 255 },
  { key: 'smtpHost', label: 'SMTP 地址', inputType: 'text' as const, maxLength: 255 },
];

it('groups custom IMAP fields without changing submitted credential keys', async () => {
  const submit = jest.fn();
  render(
    <ConfigProvider prefixCls="beyond">
      <Form layout="vertical" onFinish={submit}>
        <CredentialFields fields={fields} customImap />
        <Button htmlType="submit">保存并连接</Button>
      </Form>
    </ConfigProvider>
  );
  expect(within(screen.getByRole('group', { name: '账号信息' })).getByLabelText('邮箱地址')).toBeInTheDocument();
  expect(
    within(screen.getByRole('group', { name: 'IMAP 收信服务器' })).getByLabelText('IMAP 地址')
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole('group', { name: 'SMTP 发信服务器' })).getByLabelText('SMTP 地址')
  ).toBeInTheDocument();
  const values = ['user@example.com', 'test-secret', 'imap.example.com', 'smtp.example.com'];
  fields.forEach((field, index) =>
    fireEvent.change(screen.getByLabelText(field.label), { target: { value: values[index] } })
  );
  fireEvent.click(screen.getByText('保存并连接'));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({
      email: 'user@example.com',
      authCode: 'test-secret',
      imapHost: 'imap.example.com',
      smtpHost: 'smtp.example.com',
    })
  );
});

it('keeps generic connector fields and required validation', async () => {
  const submit = jest.fn();
  render(
    <Form onFinish={submit}>
      <CredentialFields fields={fields.slice(0, 1)} />
      <Button htmlType="submit">保存</Button>
    </Form>
  );
  expect(screen.queryByRole('group')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
  expect(await screen.findByText('请输入邮箱地址')).toBeInTheDocument();
  expect(submit).not.toHaveBeenCalled();
});

it('renders media number and JSON textarea fields', () => {
  render(
    <Form>
      <CredentialFields
        fields={[
          { key: 'readTimeoutSeconds', label: '读取超时（秒）', inputType: 'number', maxLength: 4 },
          { key: 'headersJson', label: 'Headers (JSON)', inputType: 'textarea', maxLength: 8192 },
        ]}
      />
    </Form>
  );

  expect(screen.getByRole('spinbutton', { name: '读取超时（秒）' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Headers (JSON)' })).toHaveAttribute('maxlength', '8192');
});

it('initializes and submits safe connector field defaults', async () => {
  const submit = jest.fn();
  render(
    <Form onFinish={submit}>
      <CredentialFields
        fields={[
          {
            key: 'modelProtocol',
            label: '模型协议',
            inputType: 'text',
            maxLength: 64,
            defaultValue: 'OPENAI_IMAGE',
          },
          {
            key: 'connectTimeoutSeconds',
            label: '连接超时（秒）',
            inputType: 'number',
            maxLength: 4,
            defaultValue: '30',
          },
        ]}
      />
      <Button htmlType="submit">保存</Button>
    </Form>
  );

  expect(screen.getByLabelText('模型协议')).toHaveValue('OPENAI_IMAGE');
  expect(screen.getByLabelText('连接超时（秒）')).toHaveValue(30);
  fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({ modelProtocol: 'OPENAI_IMAGE', connectTimeoutSeconds: '30' })
  );
});

it('renders connector field examples and descriptions', () => {
  render(
    <Form>
      <CredentialFields
        fields={[
          {
            key: 'apiEndpoint',
            label: 'API Endpoint',
            inputType: 'text',
            maxLength: 2048,
            placeholder: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
            description: '填写完整 HTTPS 请求地址，不是账号、应用 ID 或 Endpoint ID。',
          },
        ]}
      />
    </Form>
  );

  expect(screen.getByLabelText('API Endpoint')).toHaveAttribute(
    'placeholder',
    'https://ark.cn-beijing.volces.com/api/v3/images/generations'
  );
  expect(screen.getByText('填写完整 HTTPS 请求地址，不是账号、应用 ID 或 Endpoint ID。')).toBeInTheDocument();
});

it('keeps advanced defaults submitted while showing only the token initially', async () => {
  const submit = jest.fn();
  render(
    <Form onFinish={submit}>
      <CredentialFields
        fields={[
          { key: 'apiToken', label: 'API Token', inputType: 'password', maxLength: 2048 },
          {
            key: 'modelProtocol',
            label: '模型协议',
            inputType: 'text',
            maxLength: 128,
            defaultValue: 'VOLCENGINE_IMAGE',
            advanced: true,
          },
        ]}
      />
      <Button htmlType="submit">保存并连接</Button>
    </Form>
  );

  expect(screen.getByText('高级配置').closest('details')).not.toHaveAttribute('open');
  fireEvent.change(screen.getByLabelText('API Token'), { target: { value: 'test-token' } });
  fireEvent.click(screen.getByText('保存并连接'));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({ apiToken: 'test-token', modelProtocol: 'VOLCENGINE_IMAGE' })
  );
});
