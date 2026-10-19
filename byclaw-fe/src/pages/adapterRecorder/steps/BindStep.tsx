import { useIntl, getIntl } from '@umijs/max';
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
  get tab_projection() {
    return getIntl().formatMessage({ id: 'adapterRecorder.bind.screencastHint' });
  },
  get embedded_iframe() {
    return getIntl().formatMessage({ id: 'adapterRecorder.bind.embeddedHint' });
  },
  get vnc() {
    return getIntl().formatMessage({ id: 'adapterRecorder.bind.vncHint' });
  },
};

const MODE_OPTIONS: Record<RecordingMode, { label: string; value: RecordingMode; icon: ReactNode }> = {
  tab_projection: {
    get label() {
      return getIntl().formatMessage({ id: 'adapterRecorder.bind.screencast' });
    },
    value: 'tab_projection',
    icon: <DesktopOutlined />,
  },
  embedded_iframe: {
    get label() {
      return getIntl().formatMessage({ id: 'adapterRecorder.bind.embedded' });
    },
    value: 'embedded_iframe',
    icon: <BlockOutlined />,
  },
  vnc: {
    get label() {
      return getIntl().formatMessage({ id: 'adapterRecorder.bind.vnc' });
    },
    value: 'vnc',
    icon: <CloudServerOutlined />,
  },
};

export default function BindStep({ loading, onBind }: Props) {
  const intl = useIntl();
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
    <Card title={intl.formatMessage({ id: 'adapterRecorder.bind.create' })} variant="borderless">
      <Paragraph type="secondary" style={{ lineHeight: 1.7 }}>
        {intl.formatMessage({ id: 'adapterRecorder.bind.instructionsBefore' })}
        <strong>{intl.formatMessage({ id: 'adapterRecorder.bind.noTabYet' })}</strong>
        {intl.formatMessage({ id: 'adapterRecorder.bind.instructionsAfter' })}
      </Paragraph>

      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Form layout="vertical">
          <Form.Item
            label={intl.formatMessage({ id: 'adapterRecorder.bind.url' })}
            required
            htmlFor="target-url"
            style={{ marginBottom: 12 }}
          >
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
            <Form.Item label={intl.formatMessage({ id: 'adapterRecorder.bind.mode' })} style={{ marginBottom: 12 }}>
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
            message={intl.formatMessage({ id: 'adapterRecorder.bind.loginQuestion' })}
            description={intl.formatMessage({ id: 'adapterRecorder.bind.loginHint' })}
          />

          <Button type="primary" loading={loading} disabled={!url.trim()} onClick={handleBind}>
            {intl.formatMessage({ id: 'adapterRecorder.bind.create' })}
          </Button>
        </Form>
      </Space>
    </Card>
  );
}
