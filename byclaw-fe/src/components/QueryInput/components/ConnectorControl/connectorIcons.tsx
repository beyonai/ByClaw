import type { ReactNode } from 'react';
import Icon, {
  ApiOutlined,
  CloudOutlined,
  FileTextOutlined,
  GlobalOutlined,
  GithubOutlined,
  LinkOutlined,
  MailOutlined,
  QqOutlined,
  ThunderboltOutlined,
  WindowsFilled,
} from '@ant-design/icons';
import AntdIcon from '@/components/AntdIcon';

// 本地矢量标识随图标字号缩放，避免外部图片加载失败后再次显示相同的通用图标。
const GmailSvg = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" data-icon="gmail">
    <path d="M3 20h3V9L2 6v13a1 1 0 0 0 1 1Z" fill="#4285f4" />
    <path d="M18 20h3a1 1 0 0 0 1-1V6l-4 3v11Z" fill="#34a853" />
    <path d="M18 5v4l4-3V5a2 2 0 0 0-3.2-1.6L18 5Z" fill="#fbbc04" />
    <path d="M6 9v-4l6 4.5L18 5v4l-6 4.5L6 9Z" fill="#ea4335" />
    <path d="M2 5v1l4 3V5l-.8-1.6A2 2 0 0 0 2 5Z" fill="#c5221f" />
  </svg>
);

const NeteaseMailSvg = () => (
  <svg viewBox="0 0 32 32" width="1em" height="1em" fill="none" data-icon="netease-mail">
    <rect x="1.5" y="5.5" width="29" height="22" rx="3" stroke="#d93025" strokeWidth="2" />
    <path d="m3 7 13 8L29 7" stroke="#d93025" strokeWidth="2" strokeLinejoin="round" />
    <text
      x="16"
      y="24"
      fill="#d93025"
      fontSize="12"
      fontWeight="700"
      fontFamily="Arial, sans-serif"
      textAnchor="middle"
    >
      163
    </text>
  </svg>
);

// 优先按稳定编码匹配品牌，避免名称翻译影响图标；各入口共用接口数据中的 icon。
const connectorIconMap: Record<string, ReactNode> = {
  dingtalk: <AntdIcon type="icon-dingding1" />,
  wecom: <AntdIcon type="icon-qiyeweixin" />,
  lark: <AntdIcon type="icon-feishu" />,
  github: <GithubOutlined />,
  'ima-openapi': <FileTextOutlined />,
  'weixin-official-api': <GlobalOutlined />,
  'weixin-open-platform': <LinkOutlined />,
  'gmail-mail': <Icon component={GmailSvg} aria-hidden />,
  'qq-mail': <QqOutlined />,
  'netease-163-mail': <Icon component={NeteaseMailSvg} aria-hidden />,
  'microsoft-mail': <WindowsFilled />,
  'fastmail-mail': <ThunderboltOutlined />,
  'aliyun-mail': <CloudOutlined />,
  'custom-imap-mail': <MailOutlined />,
};

export const getConnectorIcon = (connectorCode: string, connectorName?: string): ReactNode => {
  if (connectorIconMap[connectorCode]) return connectorIconMap[connectorCode];
  // 兼容旧编码或新增邮箱平台；未识别的邮箱仍展示邮件图标。
  const name = connectorName || '';
  if (/gmail/i.test(name)) return connectorIconMap['gmail-mail'];
  if (/qq\s*(邮箱|mail)/i.test(name)) return connectorIconMap['qq-mail'];
  if (/(?:网易|netease)\s*163|163\s*(?:邮箱|mail)/i.test(name)) return connectorIconMap['netease-163-mail'];
  if (/邮箱|邮件|mail|imap/i.test(name)) return <MailOutlined />;
  if (name.includes('公众号')) return <GlobalOutlined />;
  if (name.includes('开放平台')) return <LinkOutlined />;
  if (name.toUpperCase().includes('IMA')) return <FileTextOutlined />;
  return <ApiOutlined />;
};
