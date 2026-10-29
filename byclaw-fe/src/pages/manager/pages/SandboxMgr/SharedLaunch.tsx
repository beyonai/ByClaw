import { launchSharedInstance, listSharedConfigs, type SharedConfig } from '@/pages/manager/service/SharedSandbox';
import { useIntl } from '@umijs/max';
import { Alert, DatePicker, Form, InputNumber, Modal, Radio, Select, message } from 'antd';
import { useEffect, useState } from 'react';
import dayjs from 'dayjs';

export default function SharedLaunch({ onClose, onLaunched }: { onClose: () => void; onLaunched: () => void }) {
  const intl = useIntl();
  const t = (name: string) => intl.formatMessage({ id: `sandboxMgr.shared.launch.${name}` });
  const [form] = Form.useForm();
  const [configs, setConfigs] = useState<SharedConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // Keep the same identity across retries after ambiguous provider/network outcomes.
  const [requestId] = useState(() =>
    Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)), (v) => v.toString(16).padStart(8, '0')).join('')
  );
  const service = Form.useWatch('serviceKey', form);
  const policy = Form.useWatch('releasePolicy', form);
  const schedule = Form.useWatch('schedule', form);
  useEffect(() => {
    let mounted = true;
    listSharedConfigs()
      .then((rows) => {
        if (mounted) setConfigs(rows.filter((row) => row.enabled === true || row.enabled === 1));
      })
      .catch(() => {
        if (mounted) setError(t('loadFailed'));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);
  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const releaseAt =
        values.releasePolicy === 'SCHEDULED' && values.schedule === 'date' ? values.date.valueOf() : undefined;
      const durationSeconds =
        values.releasePolicy === 'SCHEDULED' && values.schedule === 'duration' ? values.minutes * 60 : undefined;
      await launchSharedInstance({
        requestId,
        serviceKey: values.serviceKey,
        profileKey: values.profileKey,
        releasePolicy: values.releasePolicy,
        durationSeconds,
        releaseAt,
      });
      message.success(t('submitted'));
      onLaunched();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('failed'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      title={t('title')}
      onCancel={onClose}
      onOk={submit}
      confirmLoading={saving}
      maskClosable={false}
      closable={!saving}
      cancelButtonProps={{ disabled: saving }}
      okButtonProps={{ disabled: loading || !configs.length }}
      okText={t('submit')}
      cancelText={t('cancel')}
    >
      {error && <Alert type="error" showIcon message={error} />}
      <Form
        form={form}
        layout="vertical"
        initialValues={{ releasePolicy: 'HEARTBEAT', schedule: 'duration', minutes: 120 }}
      >
        <Form.Item name="serviceKey" label={t('service')} rules={[{ required: true, message: t('required') }]}>
          <Select
            loading={loading}
            onChange={() => form.setFieldValue('profileKey', undefined)}
            options={[...new Set(configs.map((row) => row.serviceKey))].map((value) => ({ value, label: value }))}
          />
        </Form.Item>
        <Form.Item name="profileKey" label={t('profile')} rules={[{ required: true, message: t('required') }]}>
          <Select
            disabled={!service}
            options={configs
              .filter((row) => row.serviceKey === service)
              .map((row) => ({
                value: row.profileKey,
                label: `${row.profileKey} · ${row.resourceLimits?.cpu || '-'} CPU / ${
                  row.resourceLimits?.memory || '-'
                }`,
              }))}
          />
        </Form.Item>
        <Form.Item name="releasePolicy" label={t('policy')}>
          <Radio.Group options={['HEARTBEAT', 'NEVER', 'SCHEDULED'].map((value) => ({ value, label: t(value) }))} />
        </Form.Item>
        {policy === 'SCHEDULED' && (
          <>
            <Alert type="info" showIcon message={t('expiryNotice')} />
            <Form.Item name="schedule" label={t('schedule')}>
              <Radio.Group
                options={[
                  { value: 'duration', label: t('duration') },
                  { value: 'date', label: t('date') },
                ]}
              />
            </Form.Item>
            {schedule === 'duration' ? (
              <Form.Item
                name="minutes"
                label={t('minutes')}
                rules={[{ required: true, type: 'number', min: 1, max: 525600, message: t('invalidDuration') }]}
              >
                <InputNumber min={1} max={525600} precision={0} />
              </Form.Item>
            ) : (
              <Form.Item
                name="date"
                label={t('date')}
                rules={[
                  {
                    validator: (_, value) =>
                      value && value.valueOf() > Date.now() && value.valueOf() <= Date.now() + 31536000000
                        ? Promise.resolve()
                        : Promise.reject(new Error(t('invalidDate'))),
                  },
                ]}
              >
                <DatePicker showTime disabledDate={(value) => value.isBefore(dayjs(), 'day')} />
              </Form.Item>
            )}
          </>
        )}
      </Form>
    </Modal>
  );
}
