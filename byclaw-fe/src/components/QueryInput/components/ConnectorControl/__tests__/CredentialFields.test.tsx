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
