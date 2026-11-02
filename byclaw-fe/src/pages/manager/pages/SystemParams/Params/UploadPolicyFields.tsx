import { Alert, InputNumber, Space, Typography } from 'antd';
import { useIntl } from '@umijs/max';
import { getUploadPolicyFields, mergeUploadPolicyFields, type UploadPolicyFields } from './uploadPolicy';

export default function UploadPolicyEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const intl = useIntl();
  let fields: UploadPolicyFields;
  try {
    fields = getUploadPolicyFields(value);
  } catch {
    return <Alert type="error" message={intl.formatMessage({ id: 'SystemParams.uploadPolicy.invalid' })} />;
  }
  const change = (field: keyof UploadPolicyFields, next: number | null) => {
    if (
      next === null ||
      !Number.isSafeInteger(next) ||
      next < 1 ||
      (field === 'resumableChunkSizeMB' && next > 16) ||
      (field === 'resumableMaxFileSizeMB' && next > 8796093022207)
    )
      return;
    onChange(mergeUploadPolicyFields(value, { ...fields, [field]: next }));
  };
  return (
    <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 16 }}>
      <Typography.Text strong>{intl.formatMessage({ id: 'SystemParams.uploadPolicy.title' })}</Typography.Text>
      <label>
        {intl.formatMessage({ id: 'SystemParams.uploadPolicy.maxSize' })}
        <InputNumber
          aria-label={intl.formatMessage({ id: 'SystemParams.uploadPolicy.maxSize' })}
          min={1}
          precision={0}
          value={fields.resumableMaxFileSizeMB}
          onChange={(next) => change('resumableMaxFileSizeMB', next)}
          style={{ marginLeft: 8, width: 140 }}
        />
      </label>
      <label>
        {intl.formatMessage({ id: 'SystemParams.uploadPolicy.chunkSize' })}
        <InputNumber
          aria-label={intl.formatMessage({ id: 'SystemParams.uploadPolicy.chunkSize' })}
          min={1}
          max={16}
          precision={0}
          value={fields.resumableChunkSizeMB}
          onChange={(next) => change('resumableChunkSizeMB', next)}
          style={{ marginLeft: 8, width: 140 }}
        />
      </label>
      <Typography.Text type="secondary">{intl.formatMessage({ id: 'SystemParams.uploadPolicy.help' })}</Typography.Text>
    </Space>
  );
}
