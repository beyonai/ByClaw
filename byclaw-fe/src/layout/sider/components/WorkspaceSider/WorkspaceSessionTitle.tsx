import { AudioOutlined } from '@ant-design/icons';

export default function WorkspaceSessionTitle({
  title,
  fallback,
  voiceLabel,
}: {
  title?: string;
  fallback: string;
  voiceLabel: string;
}) {
  if (title?.trim() === '[语音消息]') {
    return (
      <span role="img" aria-label={voiceLabel} title={voiceLabel}>
        <AudioOutlined aria-hidden style={{ fontSize: 16, verticalAlign: 'middle' }} />
      </span>
    );
  }
  return <>{title || fallback}</>;
}
