import { render, screen } from '@testing-library/react';

import CredentialHelpCard from '../CredentialHelpCard';

const structuredHelpText =
  '连接器作用：安全保存公众号 AppID 和 AppSecret，并在启用时提供给数字员工。\n\n获取步骤：\n1. 登录微信开发者平台。\n2. 选择目标公众号。\n3. 打开开发接口管理。\n4. 复制 AppID。\n5. 查看或重置 AppSecret。\n6. 配置出口 IP 白名单。\n7. 返回本页保存连接。\n\n安全提示：AppSecret 相当于 API 密码，请妥善保存。';

describe('CredentialHelpCard', () => {
  it('renders titled sections, numbered steps, and warning emphasis', () => {
    render(<CredentialHelpCard helpText={structuredHelpText} />);

    expect(screen.getByRole('region', { name: '凭据获取说明' })).toHaveClass('credentialHelpCard');
    expect(screen.getByRole('heading', { name: '连接器作用' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '获取步骤' })).toBeInTheDocument();
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByRole('heading', { name: '安全提示' }).parentElement).toHaveClass('warningSection');
  });

  it('keeps unstructured connector help in the common card', () => {
    render(<CredentialHelpCard helpText="普通凭据说明" />);

    const card = screen.getByRole('region', { name: '凭据获取说明' });
    expect(card).toHaveClass('credentialHelpCard');
    expect(card).toHaveTextContent('普通凭据说明');
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
