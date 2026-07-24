/* eslint-disable lines-around-comment */
// vnc 录制模式的画面区域:iframe 直连容器宿主映射的 noVNC 端口(autoconnect + scale 自适应)。
// 用户在该画面里直接操作容器内 Chromium;停止/状态由 dashboard 自己的 toolbar 驱动(走 useRecorderSession),
// 不在 iframe 内放工具栏(原生工具栏方案)。无 vncUrl 时显示未就绪提示。
import { Empty, theme } from 'antd';
import { isDevelopment } from '@/utils/common';

interface Props {
  /** bind 返回的容器 noVNC 画面 URL(http://127.0.0.1:<宿主端口>/vnc.html)。 */
  vncUrl?: string;
}

export function buildVncFrameSrc(vncUrl: string): string {
  const baseUrl = isDevelopment() ? URI_TARGET : window.location.origin;
  const url = new URL(vncUrl, baseUrl);
  if (!url.pathname.endsWith('/')) {
    url.pathname += '/';
  }
  url.searchParams.set('autoconnect', 'true');
  url.searchParams.set('resize', 'scale');
  url.searchParams.set('reconnect', 'true');
  url.searchParams.set('hideHeader', 'true');
  return url.toString();
}

export default function VncFrame({ vncUrl }: Props) {
  const { token } = theme.useToken();
  if (!vncUrl) {
    return (
      <div
        style={{
          height: '100%',
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: token.colorFillQuaternary,
          borderRadius: token.borderRadius,
        }}
      >
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="VNC 容器画面未就绪" />
      </div>
    );
  }
  const src = buildVncFrameSrc(vncUrl);
  return (
    <iframe
      title="vnc-recording"
      src={src}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadius,
        background: '#000',
        display: 'block',
      }}
    />
  );
}
