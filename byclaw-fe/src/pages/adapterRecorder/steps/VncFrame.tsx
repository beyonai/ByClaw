/* eslint-disable lines-around-comment */
// vnc 录制模式的画面区域:iframe 直连容器宿主映射的 noVNC 端口(autoconnect + scale 自适应)。
// 用户在该画面里直接操作容器内 Chromium;停止/状态由 dashboard 自己的 toolbar 驱动(走 useRecorderSession),
// 不在 iframe 内放工具栏(原生工具栏方案)。无 vncUrl 时显示未就绪提示。
import { Empty, theme } from 'antd';

interface Props {
  /** bind 返回的容器 noVNC 画面 URL(http://127.0.0.1:<宿主端口>/vnc.html)。 */
  vncUrl?: string;
  height?: number;
}

export default function VncFrame({ vncUrl, height = 560 }: Props) {
  const { token } = theme.useToken();
  if (!vncUrl) {
    return (
      <div
        style={{
          height,
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
  // autoconnect 免点连接;resize=scale 让画面自适应 iframe 尺寸;reconnect 容器抖动自愈。
  const src = `${vncUrl}${vncUrl.includes('?') ? '&' : '?'}autoconnect=true&resize=scale&reconnect=true`;
  return (
    <iframe
      title="vnc-recording"
      src={src}
      style={{
        width: '100%',
        height,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadius,
        background: '#000',
        display: 'block',
      }}
    />
  );
}
