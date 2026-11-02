import { render } from '@testing-library/react';
import { getConnectorIcon } from '../connectorIcons';

jest.mock('@/components/AntdIcon', () => ({ type }: { type: string }) => <svg data-icon={type} />);

describe('connector icons', () => {
  it.each([
    ['gmail-mail', 'gmail'],
    ['qq-mail', 'qq'],
    ['netease-163-mail', 'netease-mail'],
    ['microsoft-mail', 'windows'],
    ['fastmail-mail', 'thunderbolt'],
    ['aliyun-mail', 'cloud'],
    ['custom-imap-mail', 'mail'],
    ['github', 'github'],
    ['dingtalk', 'icon-dingding1'],
    ['wecom', 'icon-qiyeweixin'],
    ['lark', 'icon-feishu'],
    ['ima-openapi', 'file-text'],
    ['weixin-official-api', 'global'],
    ['weixin-open-platform', 'link'],
    ['deepseek-web-search', 'deepseek'],
    ['image-generation-model', 'image-generation'],
    ['speech-generation-model', 'speech-generation'],
  ])('matches %s by code without relying on its localized name', (code, icon) => {
    const { container } = render(<>{getConnectorIcon(code)}</>);
    expect(container.querySelector(`svg[data-icon="${icon}"]`)).toBeInTheDocument();
  });

  it.each([
    ['Gmail', 'gmail'],
    ['QQ 邮箱', 'qq'],
    ['QQ Mail', 'qq'],
    ['网易 163 邮箱', 'netease-mail'],
    ['NetEase 163 Mail', 'netease-mail'],
    ['企业邮箱', 'mail'],
    ['Other Mail', 'mail'],
    ['微信公众号', 'global'],
    ['微信开放平台', 'link'],
    ['IMA 知识库', 'file-text'],
  ])('recognizes the name %s when the code is unknown', (name, icon) => {
    const { container } = render(<>{getConnectorIcon('legacy-provider', name)}</>);
    expect(container.querySelector(`svg[data-icon="${icon}"]`)).toBeInTheDocument();
  });

  it('prefers a known code over a conflicting name', () => {
    const { container } = render(<>{getConnectorIcon('qq-mail', 'Gmail')}</>);
    expect(container.querySelector('svg[data-icon="qq"]')).toBeInTheDocument();
    expect(container.querySelector('svg[data-icon="gmail"]')).not.toBeInTheDocument();
  });

  it('keeps the generic connector fallback for an unknown platform', () => {
    const { container } = render(<>{getConnectorIcon('unknown')}</>);
    expect(container.querySelector('svg[data-icon="api"]')).toBeInTheDocument();
  });

  it('reuses the DeepSeek brand asset under the runtime deployment path', () => {
    const originalPublicPath = window.publicPath;
    try {
      window.publicPath = '/byclaw';
      const { container } = render(<>{getConnectorIcon('deepseek-web-search', 'Gmail')}</>);
      expect(container.querySelector('svg[data-icon="deepseek"] image')).toHaveAttribute(
        'href',
        '/byclaw/model-providers/deepseek.svg'
      );
    } finally {
      window.publicPath = originalPublicPath;
    }
  });
});
