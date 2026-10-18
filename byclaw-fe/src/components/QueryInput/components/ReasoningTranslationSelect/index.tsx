import { useEffect, useState } from 'react';
import { useIntl, useSelector } from '@umijs/max';
import { Button, Popover, Select, Space, Switch, Typography } from 'antd';
import { TranslationOutlined } from '@ant-design/icons';
import { getMyModels, getPublicModels } from '@/pages/models/service';
import {
  readReasoningTranslationSettings,
  writeReasoningTranslationSettings,
  type ReasoningTranslationSettings,
} from '@/utils/reasoningTranslationSettings';
import { rowsOf } from '../ModelSelect';

export default function ReasoningTranslationSelect({ sessionId }: { sessionId?: string }) {
  const intl = useIntl();
  const authIdentity = useSelector(
    ({ user }: any) => user?.userInfo?.userId || user?.userInfo?.id || user?.userInfo?.sessionId
  );
  const [settings, setSettings] = useState(() => readReasoningTranslationSettings(sessionId));
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const label = intl.formatMessage({ id: 'reasoningTranslation.label' });

  useEffect(() => {
    if (!open || !authIdentity) return undefined;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    Promise.all([
      getMyModels({ pageNum: 1, pageSize: 100, modelType: 'LLM', status: 'ENABLED' }),
      getPublicModels({ pageNum: 1, pageSize: 100, modelType: 'LLM' }),
    ])
      .then((responses) => {
        if (cancelled) return;
        const models = responses.flatMap(rowsOf);
        setOptions(
          models
            .map((model: any) => ({
              value: `${model.id ?? model.modelId}`,
              label: model.displayName || model.modelName || model.modelCode,
            }))
            .filter(
              (model, index, list) =>
                /^\d+$/.test(model.value) && list.findIndex((item) => item.value === model.value) === index
            )
        );
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, authIdentity]);

  const update = (next: ReasoningTranslationSettings) => {
    setSettings(next);
    writeReasoningTranslationSettings(sessionId, next);
  };

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      content={
        <Space direction="vertical" style={{ width: 280 }}>
          <Space>
            <span>{label}</span>
            <Switch
              aria-label={label}
              checked={settings.translateReasoning}
              disabled={!settings.reasoningTranslationModelId}
              onChange={(checked) => update({ ...settings, translateReasoning: checked })}
            />
          </Space>
          <Select
            aria-label={intl.formatMessage({ id: 'reasoningTranslation.model' })}
            placeholder={intl.formatMessage({ id: 'reasoningTranslation.model' })}
            style={{ width: '100%' }}
            showSearch
            optionFilterProp="label"
            loading={loading}
            options={options}
            value={settings.reasoningTranslationModelId}
            onChange={(value) => update({ ...settings, reasoningTranslationModelId: value })}
          />
          <Typography.Text type={failed ? 'danger' : 'secondary'}>
            {intl.formatMessage({ id: failed ? 'reasoningTranslation.loadFailed' : 'reasoningTranslation.hint' })}
          </Typography.Text>
        </Space>
      }
    >
      <Button type="text" size="small" icon={<TranslationOutlined />} aria-pressed={settings.translateReasoning}>
        {label}
        {settings.translateReasoning ? ' ✓' : ''}
      </Button>
    </Popover>
  );
}
