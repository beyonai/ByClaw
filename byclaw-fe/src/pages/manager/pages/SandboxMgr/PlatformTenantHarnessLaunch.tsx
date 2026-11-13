import {
  ensurePlatformTenantHarness,
  getPlatformTenantHarness,
  TENANT_HARNESS_TYPE,
  type TenantHarnessState,
} from '@/pages/manager/service/TenantMgr';
import { ReloadOutlined, RocketOutlined } from '@ant-design/icons';
import { useDispatch, useIntl } from '@umijs/max';
import { useRequest } from 'ahooks';
import { Alert, Button, Form, Modal, Select, Space } from 'antd';
import { useEffect, useRef, useState } from 'react';

const pendingStatuses = new Set<TenantHarnessState['status']>(['PENDING', 'RUNNING', 'RETRY_WAIT']);
const recheckStatuses = new Set<TenantHarnessState['status']>(['FAILED', 'SUCCEEDED', 'MANUAL_REQUIRED']);

interface ProfileOption {
  serviceType: string;
  profileKey: string;
}

interface Props {
  onResourcesChanged: () => void;
}

function LaunchDialog({ onClose, onResourcesChanged }: Props & { onClose: () => void }) {
  const intl = useIntl();
  const dispatch = useDispatch();
  const [form] = Form.useForm<{ profileKey: string }>();
  const [profileKeys, setProfileKeys] = useState<string[] | 'error'>();
  const wasPending = useRef(false);
  const {
    data: state,
    error: statusError,
    loading,
    refresh,
    mutate,
  } = useRequest(getPlatformTenantHarness, {
    onSuccess: (result) => {
      const pending = pendingStatuses.has(result.status);
      if (wasPending.current && !pending) onResourcesChanged();
      wasPending.current = pending;
    },
    onError: () => undefined,
  });
  const {
    run: ensure,
    loading: submitting,
    error: submitError,
  } = useRequest(ensurePlatformTenantHarness, {
    manual: true,
    onSuccess: (result) => {
      wasPending.current = pendingStatuses.has(result.status);
      mutate(result);
      onResourcesChanged();
    },
    onError: () => refresh(),
  });

  useEffect(() => {
    let active = true;
    dispatch({
      type: 'sandboxMgr/listServiceProfiles',
      payload: { serviceType: TENANT_HARNESS_TYPE, enabledOnly: true },
      success: (profiles: ProfileOption[]) => {
        if (active) {
          setProfileKeys(
            profiles
              .filter((profile) => profile.serviceType === TENANT_HARNESS_TYPE)
              .map((profile) => profile.profileKey)
          );
        }
      },
      fail: () => {
        if (active) setProfileKeys('error');
      },
    });
    return () => {
      active = false;
    };
  }, [dispatch]);

  const pending = state ? pendingStatuses.has(state.status) : false;
  useEffect(() => {
    if (!pending || loading) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') refresh();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [pending, loading, refresh]);

  const options = Array.isArray(profileKeys) ? profileKeys : [];
  const frozenProfile = state?.profileKey;
  const canLaunch = state?.status === 'NOT_REQUESTED' && !state.workerReady && !statusError;
  const rechecking = state && recheckStatuses.has(state.status);
  const canRecheck = rechecking && !state.workerReady && !statusError && !!frozenProfile;
  const warned = state?.status === 'FAILED' || state?.status === 'MANUAL_REQUIRED';

  return (
    <Modal
      title={intl.formatMessage({ id: 'sandboxMgr.tenantHarness.launch' })}
      open
      onCancel={onClose}
      onOk={() => {
        if (submitting) return;
        if (canRecheck) ensure(frozenProfile);
        else if (canLaunch) form.submit();
      }}
      okText={intl.formatMessage({ id: `sandboxMgr.tenantHarness.${rechecking ? 'recheck' : 'submit'}` })}
      okButtonProps={{ disabled: !(canRecheck || (canLaunch && options.length)) }}
      confirmLoading={submitting}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {state && (
          <Alert
            showIcon
            type={state.workerReady ? 'success' : warned ? 'warning' : 'info'}
            message={intl.formatMessage({
              id: `sandboxMgr.tenantHarness.status.${state.workerReady ? 'READY' : state.status}`,
            })}
            description={state.errorCode}
          />
        )}
        {!state && loading && <Alert message={intl.formatMessage({ id: 'sandboxMgr.tenantHarness.loading' })} />}
        {statusError && (
          <Alert
            showIcon
            type="error"
            message={intl.formatMessage({ id: 'sandboxMgr.tenantHarness.statusFailed' })}
            action={
              <Button icon={<ReloadOutlined aria-hidden="true" />} loading={loading} onClick={refresh}>
                {intl.formatMessage({ id: 'sandboxMgr.action.refresh' })}
              </Button>
            }
          />
        )}
        {submitError && <Alert showIcon type="error" message={String(submitError)} />}
        <Form
          form={form}
          layout="vertical"
          onFinish={({ profileKey }) => canLaunch && !submitting && ensure(profileKey)}
        >
          {frozenProfile && (
            <Form.Item label={intl.formatMessage({ id: 'sandboxMgr.tenantHarness.profile' })}>
              {frozenProfile}
            </Form.Item>
          )}
          {canLaunch && (
            <Form.Item
              name="profileKey"
              label={intl.formatMessage({ id: 'sandboxMgr.tenantHarness.profile' })}
              rules={[
                { required: true, message: intl.formatMessage({ id: 'sandboxMgr.tenantHarness.selectProfile' }) },
              ]}
            >
              <Select
                disabled={!options.length || submitting}
                loading={profileKeys === undefined}
                placeholder={intl.formatMessage({ id: 'sandboxMgr.tenantHarness.selectProfile' })}
                options={options.map((key) => ({ value: key, label: key }))}
              />
            </Form.Item>
          )}
        </Form>
        {canLaunch && profileKeys === 'error' && (
          <Alert showIcon type="error" message={intl.formatMessage({ id: 'sandboxMgr.error.profiles' })} />
        )}
        {canLaunch && Array.isArray(profileKeys) && profileKeys.length === 0 && (
          <Alert showIcon type="info" message={intl.formatMessage({ id: 'sandboxMgr.tenantHarness.noProfiles' })} />
        )}
      </Space>
    </Modal>
  );
}

export default function PlatformTenantHarnessLaunch({ onResourcesChanged }: Props) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon={<RocketOutlined aria-hidden="true" />} onClick={() => setOpen(true)}>
        {intl.formatMessage({ id: 'sandboxMgr.tenantHarness.launch' })}
      </Button>
      {open && <LaunchDialog onClose={() => setOpen(false)} onResourcesChanged={onResourcesChanged} />}
    </>
  );
}
