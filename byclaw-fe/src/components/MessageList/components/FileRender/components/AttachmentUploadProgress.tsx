import { ReloadOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { Progress, Tooltip } from 'antd';
import styles from '../index.module.less';

interface Props {
  name?: string;
  percent?: number;
  error?: string;
  onRetry?: () => void;
}

export default function AttachmentUploadProgress({ name = '', percent = 0, error, onRetry }: Props) {
  const intl = useIntl();
  const label = `${name} ${intl.formatMessage({
    id: error ? 'queryInput.attachment.retry' : 'queryInput.attachment.progress',
  })}`;
  const circle = (
    <Progress
      type="circle"
      size={34}
      strokeWidth={7}
      percent={Math.min(100, Math.max(0, percent))}
      status={error ? 'exception' : 'normal'}
      aria-label={label}
      format={(value) =>
        error ? (
          <ReloadOutlined />
        ) : (
          <span className={styles.uploadPercent}>
            {Math.round(value || 0)}
            <span>%</span>
          </span>
        )
      }
    />
  );
  if (error && onRetry) {
    return (
      <Tooltip title={error}>
        <button
          type="button"
          className={styles.uploadRetry}
          aria-label={label}
          onClick={(event) => {
            event.stopPropagation();
            onRetry();
          }}
        >
          {circle}
        </button>
      </Tooltip>
    );
  }
  return circle;
}
