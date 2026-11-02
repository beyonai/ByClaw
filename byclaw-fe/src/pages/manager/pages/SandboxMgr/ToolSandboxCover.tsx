import { DeleteOutlined, UploadOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { Button, Input, message, Space, Upload } from 'antd';
import { useState } from 'react';
import { isValidToolCover, MAX_TOOL_COVER_BYTES } from './serviceSpecUtils';
import styles from './market.module.less';

interface Props {
  value?: string;
  onChange?: (value: string) => void;
}

export default function ToolSandboxCover({ value = '', onChange }: Props) {
  const intl = useIntl();
  const t = (key: string) => intl.formatMessage({ id: `sandboxMgr.market.${key}` });
  const [reading, setReading] = useState(false);
  return (
    <div className={styles.coverEditor}>
      {value && isValidToolCover(value) && (
        <img className={styles.coverPreview} src={value} alt={t('cover')} referrerPolicy="no-referrer" />
      )}
      <Input
        aria-label={t('coverUrl')}
        placeholder={t('coverUrl')}
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
            setReading(true);
            const reader = new FileReader();
            reader.onload = () => {
              setReading(false);
              const result = typeof reader.result === 'string' ? reader.result : '';
              if (!isValidToolCover(result)) message.error(t('coverInvalid'));
              else onChange?.(result);
            };
            reader.onerror = () => {
              setReading(false);
              message.error(t('coverReadFailed'));
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
