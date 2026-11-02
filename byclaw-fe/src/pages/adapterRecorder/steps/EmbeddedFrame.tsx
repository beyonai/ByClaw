import { useIntl } from '@umijs/max';
// embedded_iframe 录制模式的画面区域:直接在 dashboard 自己的 tab 内嵌跨源目标站 iframe。
// 扩展 attach dashboard tab,经 OOPIF flat autoAttach 录 iframe 内请求(带 frameSessionId,顶层 dashboard 噪音由扩展过滤)。
// 与投屏(LivePreview)不同:用户直接在 iframe 里原生操作,无截图轮询延迟、无 Input 回传。
// 仅适用不反嵌的公开站——若目标站发 X-Frame-Options:DENY / frame-ancestors,浏览器拒渲染,
// onError/超时兜底提示用户改用投屏模式。debugger infobar 落在本 tab 顶部(Chrome 强制),故留安全间距。
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Typography, theme } from 'antd';
import { WarningOutlined } from '@ant-design/icons';

const { Text } = Typography;

const RENDER_TIMEOUT_MS = 6000; // 超时未 load 视为可能反嵌(反嵌时多数浏览器既不触发 load 也不触发 error)

interface Props {
  src?: string;
}

export default function EmbeddedFrame({ src }: Props) {
  const intl = useIntl();
  const { token } = theme.useToken();
  const [failed, setFailed] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    loadedRef.current = false;
    setFailed(false);
    if (!src) return;
    const timer = window.setTimeout(() => {
      if (!loadedRef.current) setFailed(true);
    }, RENDER_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [src]);

  if (!src) {
    return (
      <div style={{ padding: '24px 8px', textAlign: 'center' }}>
        <Text type="secondary">{intl.formatMessage({ id: 'adapterRecorder.capture.noUrl' })}</Text>
      </div>
    );
  }

  return (
    <div
      style={{ position: 'relative', display: 'flex', minHeight: 0, height: '100%', flex: 1, flexDirection: 'column' }}
    >
      {/* debugger infobar 占位:Chrome 在被 attach 的 tab 顶部强制显示黄条,留间距防遮挡 iframe 顶部内容。 */}
      <div style={{ marginBottom: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {intl.formatMessage({ id: 'adapterRecorder.embed.instructions' })}
        </Text>
      </div>
      {failed ? (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message={intl.formatMessage({ id: 'adapterRecorder.embed.unsupported' })}
          description={<span>{intl.formatMessage({ id: 'adapterRecorder.embed.unsupportedHint' })}</span>}
          action={
            <Button
              size="small"
              onClick={() => {
                loadedRef.current = false;
                setFailed(false);
              }}
            >
              {intl.formatMessage({ id: 'employeeDetail.ttsModelRetry' })}
            </Button>
          }
        />
      ) : (
        <iframe
          title="embedded-recording-target"
          src={src}
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => {
            loadedRef.current = true;
          }}
          onError={() => setFailed(true)}
          style={{
            width: '100%',
            minHeight: 0,
            flex: 1,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadius,
            background: token.colorBgContainer,
          }}
        />
      )}
    </div>
  );
}
