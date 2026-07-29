// Step 2 · 新建录制会话 —— 只输入目标 URL 并绑定浏览器(建立 sessionId),**不导航、不开标签页**。
// 开 byCLI 标签页 + 导航推迟到下一步「开始 A/B 录制」时触发。若目标站点需登录,在录制时打开的
// 标签页内自行完成登录(Recorder 只绑定已有登录,不收集或回放凭据)。
import { LinkOutlined, DesktopOutlined, BlockOutlined, CloudServerOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, Segmented, Space, Typography } from 'antd';
import { type ReactNode, useState } from 'react';
import { getEnabledRecordingModes, type RecordingMode } from '../services/recorderClient';

const { Paragraph, Text } = Typography;

interface Props {
  loading: boolean;

  /** 新建录制会话:绑定浏览器 + 保存目标 URL(不导航)。recordingMode 缺省 vnc。 */
  onBind: (url: string, recordingMode?: RecordingMode) => void;
}

const MODE_HINT: Record<RecordingMode, string> = {
  tab_projection: '目标页在独立标签页打开、画面投屏回来,对所有站点通用(含登录站)。',
  embedded_iframe: '目标页直接嵌入本页录制,交互无延迟;仅适用不反嵌的公开站,登录站会渲染失败,届时改用投屏。',
  vnc: '在容器内的浏览器中录制,画面经 noVNC 投回本页;浏览器与登录态都在容器里,适合部署到服务器集中录制。',
};

const MODE_OPTIONS: Record<RecordingMode, { label: string; value: RecordingMode; icon: ReactNode }> = {
  tab_projection: { label: '登录站(投屏)', value: 'tab_projection', icon: <DesktopOutlined /> },
  embedded_iframe: { label: '公开站(页内嵌入)', value: 'embedded_iframe', icon: <BlockOutlined /> },
  vnc: { label: 'VNC(容器)', value: 'vnc', icon: <CloudServerOutlined /> },
};

export default function BindStep({ loading, onBind }: Props) {
  const [url, setUrl] = useState('https://juejin.cn/');
  const enabledModes = getEnabledRecordingModes();
  const [mode, setMode] = useState<RecordingMode>(() =>
    enabledModes.includes('vnc') ? 'vnc' : enabledModes[0] ?? 'vnc'
  );

  const modeOptions = enabledModes.map((recordingMode) => MODE_OPTIONS[recordingMode]);
  const showModePicker = modeOptions.length > 1;

  const handleBind = () => {
    if (!url.trim()) return;
    onBind(url.trim(), mode);
  };

  return (
    <Card title="新建录制会话" variant="borderless">
      <Paragraph type="secondary" style={{ lineHeight: 1.7 }}>
        输入要录制的目标地址并点「新建录制会话」,系统只绑定浏览器、保存目标 URL,
        <strong>此时不会打开标签页</strong>。进入下一步后,点「开始 A 录制」才会新建 byCLI 标签页并打开目标页面。
      </Paragraph>

      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Form layout="vertical">
          <Form.Item label="目标 URL" required htmlFor="target-url" style={{ marginBottom: 12 }}>
            <Input
              id="target-url"
              className="code"
              prefix={<LinkOutlined />}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://juejin.cn/"
              onPressEnter={handleBind}
            />
          </Form.Item>

          {showModePicker ? (
            <Form.Item label="录制方式" style={{ marginBottom: 12 }}>
              <Segmented block value={mode} onChange={(v) => setMode(v as RecordingMode)} options={modeOptions} />
              <Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
                {MODE_HINT[mode]}
              </Text>
            </Form.Item>
          ) : null}

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="目标站点需要登录?"
            description="无需在这里处理。开始录制后会打开一个 byCLI 标签页,你可直接在该页面登录目标站点,再继续操作。Recorder 只绑定已有登录,不收集或回放凭据。"
          />

          <Button type="primary" loading={loading} disabled={!url.trim()} onClick={handleBind}>
            新建录制会话
          </Button>
        </Form>
      </Space>
    </Card>
  );
}
