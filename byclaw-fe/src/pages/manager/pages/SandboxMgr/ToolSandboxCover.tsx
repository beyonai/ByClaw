import { DeleteOutlined, UploadOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { Button, Input, message, Space, Upload } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { isValidToolCover, MAX_TOOL_COVER_BYTES } from './serviceSpecUtils';
import styles from './market.module.less';

interface Props {
  value?: string;
  onChange?: (value: string) => void;
  onReadingChange?: (reading: boolean) => void;
}

export default function ToolSandboxCover({ value = '', onChange, onReadingChange }: Props) {
  const intl = useIntl();
  const t = (key: string) => intl.formatMessage({ id: `sandboxMgr.market.${key}` });
  const [reading, setReading] = useState(false);
  const pendingReader = useRef<FileReader | null>(null);

  useEffect(() => {
    return () => {
      const reader = pendingReader.current;
      if (!reader) return;
      pendingReader.current = null;
      reader.abort();
      onReadingChange?.(false);
    };
  }, [onReadingChange]);

  return (
    <div className={styles.coverEditor}>
      {value && isValidToolCover(value) && (
        <img className={styles.coverPreview} src={value} alt={t('cover')} referrerPolicy="no-referrer" />
      )}
      <Input
        aria-label={t('coverUrl')}
        placeholder={t('coverUrl')}
        disabled={reading}
        value={value.startsWith('data:') ? '' : value}
        onChange={(event) => onChange?.(event.target.value)}
      />
      <Space>
        <Upload
          accept="image/png,image/jpeg,image/webp"
          showUploadList={false}
          disabled={reading}
          beforeUpload={(file) => {
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > MAX_TOOL_COVER_BYTES) {
              message.error(t('coverInvalid'));
              return Upload.LIST_IGNORE;
            }
            if (pendingReader.current) return Upload.LIST_IGNORE;
            const reader = new FileReader();
            pendingReader.current = reader;
            setReading(true);
            onReadingChange?.(true);
            reader.onload = () => {
              const result = typeof reader.result === 'string' ? reader.result : '';
              if (!isValidToolCover(result)) message.error(t('coverInvalid'));
              else onChange?.(result);
            };
            reader.onerror = () => message.error(t('coverReadFailed'));
            reader.onloadend = () => {
              if (pendingReader.current !== reader) return;
              pendingReader.current = null;
              setReading(false);
              onReadingChange?.(false);
            };
            reader.readAsDataURL(file);
            return false;
          }}
        >
          <Button icon={<UploadOutlined />} loading={reading}>
            {t('uploadCover')}
          </Button>
        </Upload>
        {value && (
          <Button type="text" icon={<DeleteOutlined />} disabled={reading} onClick={() => onChange?.('')}>
            {t('clearCover')}
          </Button>
        )}
      </Space>
    </div>
  );
}
