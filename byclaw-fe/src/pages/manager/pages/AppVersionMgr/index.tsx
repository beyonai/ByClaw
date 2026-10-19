import { DeleteOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { useIntl, useSelector } from '@umijs/max';
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Upload,
  message,
} from 'antd';
import { useEffect, useRef, useState } from 'react';
import {
  buildPackageDownloadUrl,
  createAppVersion,
  deleteAppVersion,
  getAppVersionCapability,
  offlineAppVersion,
  pageAppVersions,
  publishAppVersion,
  updateAppVersion,
  uploadAppPackage,
  type AppVersion,
  type AppVersionPayload,
  type AppVersionUploadResult,
} from '../../service/AppVersion';
import styles from './index.module.less';

const PLATFORMS = [
  { value: 'windows', label: 'Windows', archs: ['x64', 'arm64'] },
  { value: 'macos', label: 'macOS', archs: ['x64', 'arm64', 'universal'] },
];

const archOptions = (platform?: string) =>
  (PLATFORMS.find((item) => item.value === platform)?.archs || []).map((arch) => ({ value: arch, label: arch }));

const formatBytes = (value?: number) => {
  if (!value || value <= 0) {
    return '-';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const platformLabel = (value?: string) => PLATFORMS.find((item) => item.value === value)?.label || value || '-';

const toPayload = (values: Record<string, any>): AppVersionPayload => ({
  platform: values.platform,
  arch: values.arch,
  channel: values.channel,
  appVersion: values.appVersion?.trim(),
  url: values.url?.trim(),
  updateType: values.updateType || 'full',
  updateMsg: values.updateMsg,
  forceUpdate: Boolean(values.forceUpdate),
  fileName: values.fileName,
  fileSize: values.fileSize,
  sha256: values.sha256,
  releaseStatus: values.releaseStatus || 'draft',
});

export default function AppVersionMgr() {
  const intl = useIntl();
  // 展示标签随语言重新计算，接口枚举值保持稳定。
  const CHANNELS = [
    { value: 'stable', label: intl.formatMessage({ id: 'appVersion.channel.stable' }) },
    { value: 'beta', label: intl.formatMessage({ id: 'appVersion.channel.beta' }) },
    { value: 'dev', label: intl.formatMessage({ id: 'appVersion.channel.dev' }) },
  ];

  const UPDATE_TYPES = [
    { value: 'full', label: intl.formatMessage({ id: 'appVersion.updateType.full' }) },
    { value: 'incremental', label: intl.formatMessage({ id: 'appVersion.updateType.incremental' }) },
  ];

  const RELEASE_STATUS: Record<string, { text: string; color: string }> = {
    draft: { text: intl.formatMessage({ id: 'appVersion.status.draft' }), color: 'default' },
    published: { text: intl.formatMessage({ id: 'appVersion.status.published' }), color: 'green' },
    offline: { text: intl.formatMessage({ id: 'appVersion.status.offline' }), color: 'red' },
  };

  const userInfo = useSelector(({ user }: any) => user.userInfo);
  const [allowed, setAllowed] = useState<boolean>();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<AppVersion[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [filters, setFilters] = useState<Record<string, unknown>>({});
  const [editing, setEditing] = useState<AppVersion>();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<AppVersionUploadResult>();
  const [busyId, setBusyId] = useState<string>();
  const savingRef = useRef(false);
  const [form] = Form.useForm();
  const platform = Form.useWatch('platform', form);

  const reload = async (targetPage = page, targetSize = size, targetFilters = filters) => {
    setLoading(true);
    try {
      const result = await pageAppVersions({ ...targetFilters, page: targetPage, size: targetSize });
      setItems(result?.list || []);
      setTotal(result?.total || 0);
      setPage(targetPage);
      setSize(targetSize);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    getAppVersionCapability()
      .then((value) => {
        setAllowed(value === true);
        if (value) {
          void reload(1, 10, {});
        }
      })
      .catch(() => setAllowed(false));
  }, []);

  if (userInfo?.userCode?.toLowerCase() === 'adminvip' && allowed === undefined) return <Spin fullscreen />;
  if (userInfo?.userCode?.toLowerCase() !== 'adminvip' || !allowed) {
    return <Alert type="warning" message={intl.formatMessage({ id: 'appVersion.adminOnly' })} />;
  }

  const edit = (item?: AppVersion) => {
    setEditing(item);
    setUploaded(undefined);
    form.setFieldsValue(
      item
        ? {
          ...item,
          forceUpdate: item.updateStatus === '1',
        }
        : {
          platform: 'windows',
          arch: 'x64',
          channel: 'stable',
          updateType: 'full',
          forceUpdate: false,
          releaseStatus: 'draft',
        }
    );
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setEditing(undefined);
    setUploaded(undefined);
    form.resetFields();
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const result = await uploadAppPackage(file);
      setUploaded(result);
      form.setFieldsValue({
        url: result.url,
        fileName: result.fileName,
        fileSize: result.fileSize,
        sha256: result.sha256,
      });
      message.success(intl.formatMessage({ id: 'appVersion.uploadSuccess' }));
    } catch {
      message.error(intl.formatMessage({ id: 'appVersion.uploadFailed' }));
    } finally {
      setUploading(false);
    }
  };

  const changeStatus = async (item: AppVersion, action: 'publish' | 'offline') => {
    setBusyId(item.versionId);
    try {
      if (action === 'publish') {
        await publishAppVersion(item.versionId);
        message.success(intl.formatMessage({ id: 'appVersion.published' }));
      } else {
        await offlineAppVersion(item.versionId);
        message.success(intl.formatMessage({ id: 'appVersion.offline' }));
      }
      await reload();
    } catch {
      message.error(
        action === 'publish'
          ? intl.formatMessage({ id: 'appVersion.publishFailed' })
          : intl.formatMessage({ id: 'appVersion.offlineFailed' })
      );
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>{intl.formatMessage({ id: 'appVersion.title' })}</h1>
          <p>{intl.formatMessage({ id: 'appVersion.description' })}</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => edit()}>
          {intl.formatMessage({ id: 'appVersion.create' })}
        </Button>
      </div>

      <Form
        layout="inline"
        className={styles.filters}
        onFinish={(values) => {
          const nextFilters = Object.fromEntries(Object.entries(values).filter(([, value]) => value));
          setFilters(nextFilters);
          void reload(1, size, nextFilters);
        }}
      >
        <Form.Item name="platform" label={intl.formatMessage({ id: 'appVersion.platform' })}>
          <Select
            allowClear
            placeholder={intl.formatMessage({ id: 'appVersion.all' })}
            style={{ width: 130 }}
            options={PLATFORMS}
          />
        </Form.Item>
        <Form.Item name="arch" label={intl.formatMessage({ id: 'appVersion.arch' })}>
          <Select
            allowClear
            placeholder={intl.formatMessage({ id: 'appVersion.all' })}
            style={{ width: 120 }}
            options={archOptions(platform)}
          />
        </Form.Item>
        <Form.Item name="channel" label={intl.formatMessage({ id: 'appVersion.channel' })}>
          <Select
            allowClear
            placeholder={intl.formatMessage({ id: 'appVersion.all' })}
            style={{ width: 150 }}
            options={CHANNELS}
          />
        </Form.Item>
        <Form.Item name="releaseStatus" label={intl.formatMessage({ id: 'appVersion.status' })}>
          <Select
            allowClear
            placeholder={intl.formatMessage({ id: 'appVersion.all' })}
            style={{ width: 120 }}
            options={Object.entries(RELEASE_STATUS).map(([value, meta]) => ({ value, label: meta.text }))}
          />
        </Form.Item>
        <Form.Item name="keyword" label={intl.formatMessage({ id: 'appVersion.keyword' })}>
          <Input
            allowClear
            placeholder={intl.formatMessage({ id: 'appVersion.searchPlaceholder' })}
            style={{ width: 200 }}
          />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">
              {intl.formatMessage({ id: 'appVersion.search' })}
            </Button>
            <Button
              onClick={() => {
                setFilters({});
                void reload(1, size, {});
              }}
            >
              {intl.formatMessage({ id: 'appVersion.reset' })}
            </Button>
          </Space>
        </Form.Item>
      </Form>

      <Table
        loading={loading}
        rowKey={(item) => item.versionId}
        dataSource={items}
        pagination={{
          current: page,
          pageSize: size,
          total,
          showSizeChanger: false,
          onChange: (nextPage, nextSize) => void reload(nextPage, nextSize),
        }}
        columns={[
          {
            title: intl.formatMessage({ id: 'appVersion.platformArch' }),
            width: 160,
            render: (_, item) => (
              <div className={styles.versionCell}>
                <strong>
                  {platformLabel(item.platform)} · {item.arch || '-'}
                </strong>
                <span>{item.channel || '-'}</span>
              </div>
            ),
          },
          {
            title: intl.formatMessage({ id: 'appVersion.version' }),
            width: 170,
            render: (_, item) => (
              <Space size={4} wrap>
                <span>{item.appVersion}</span>
                {item.updateStatus === '1' && (
                  <Tag color="red">{intl.formatMessage({ id: 'appVersion.forceUpdate' })}</Tag>
                )}
              </Space>
            ),
          },
          {
            title: intl.formatMessage({ id: 'appVersion.package' }),
            render: (_, item) => (
              <div className={styles.packageCell}>
                <span>{item.fileName || '-'}</span>
                <span className={styles.muted}>
                  {formatBytes(item.fileSize)}
                  {item.sha256 ? ` · ${item.sha256.slice(0, 12)}…` : ''}
                </span>
              </div>
            ),
          },
          {
            title: intl.formatMessage({ id: 'appVersion.status' }),
            width: 100,
            render: (_, item) => {
              const meta = RELEASE_STATUS[item.releaseStatus || 'draft'] || RELEASE_STATUS.draft;
              return <Tag color={meta.color}>{meta.text}</Tag>;
            },
          },
          { title: intl.formatMessage({ id: 'appVersion.publishTime' }), dataIndex: 'publishTime', width: 180 },
          {
            title: intl.formatMessage({ id: 'common.operation' }),
            width: 240,
            render: (_, item) => (
              <Space size={0} wrap>
                <Button type="link" onClick={() => edit(item)}>
                  {intl.formatMessage({ id: 'common.edit' })}
                </Button>
                {item.releaseStatus === 'draft' && (
                  <Button
                    type="link"
                    loading={busyId === item.versionId}
                    onClick={() => void changeStatus(item, 'publish')}
                  >
                    {intl.formatMessage({ id: 'appVersion.publish' })}
                  </Button>
                )}
                {item.releaseStatus === 'published' && (
                  <Button
                    type="link"
                    loading={busyId === item.versionId}
                    onClick={() => void changeStatus(item, 'offline')}
                  >
                    {intl.formatMessage({ id: 'appVersion.takeOffline' })}
                  </Button>
                )}
                {item.url && (
                  <Button type="link" href={buildPackageDownloadUrl(item.versionId)} target="_blank">
                    {intl.formatMessage({ id: 'appVersion.download' })}
                  </Button>
                )}
                <Popconfirm
                  title={intl.formatMessage({ id: 'appVersion.deleteConfirm' })}
                  description={intl.formatMessage({ id: 'appVersion.deleteDescription' })}
                  okText={intl.formatMessage({ id: 'common.delete' })}
                  cancelText={intl.formatMessage({ id: 'common.cancel' })}
                  okButtonProps={{ danger: true }}
                  onConfirm={async () => {
                    setBusyId(item.versionId);
                    try {
                      await deleteAppVersion(item.versionId);
                      message.success(intl.formatMessage({ id: 'appVersion.deleted' }));
                      await reload();
                    } catch {
                      message.error(intl.formatMessage({ id: 'appVersion.deleteFailed' }));
                    } finally {
                      setBusyId(undefined);
                    }
                  }}
                >
                  <Button type="link" danger icon={<DeleteOutlined />}>
                    {intl.formatMessage({ id: 'common.delete' })}
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        className={styles.editorModal}
        title={
          editing ? intl.formatMessage({ id: 'appVersion.editTitle' }) : intl.formatMessage({ id: 'appVersion.create' })
        }
        open={open}
        onCancel={close}
        onOk={() => form.submit()}
        confirmLoading={saving}
        width={880}
        okText={
          editing
            ? intl.formatMessage({ id: 'appVersion.save' })
            : intl.formatMessage({ id: 'appVersion.createAction' })
        }
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          className={styles.form}
          onFinish={async (values) => {
            if (savingRef.current) return;
            const payload = toPayload(values);
            if (!payload.url) {
              message.warning(intl.formatMessage({ id: 'appVersion.packageRequired' }));
              return;
            }
            savingRef.current = true;
            setSaving(true);
            try {
              if (editing) await updateAppVersion(editing.versionId, payload);
              else await createAppVersion(payload);
              message.success(intl.formatMessage({ id: 'appVersion.saved' }));
              close();
              await reload(1, size, filters);
            } catch {
              message.error(intl.formatMessage({ id: 'appVersion.saveFailed' }));
            } finally {
              savingRef.current = false;
              setSaving(false);
            }
          }}
        >
          <div className={styles.sectionTitle}>{intl.formatMessage({ id: 'appVersion.target' })}</div>
          <div className={styles.twoColumns}>
            <Form.Item
              name="deviceType"
              label={intl.formatMessage({ id: 'appVersion.deviceType' })}
              initialValue="electron"
              extra={intl.formatMessage({ id: 'appVersion.deviceHint' })}
            >
              <Input disabled />
            </Form.Item>
            <Form.Item
              name="platform"
              label={intl.formatMessage({ id: 'appVersion.platform' })}
              rules={[{ required: true, message: intl.formatMessage({ id: 'appVersion.platformRequired' }) }]}
            >
              <Select
                options={PLATFORMS}
                onChange={(value) => {
                  const arch = form.getFieldValue('arch');
                  if (!archOptions(value).some((item) => item.value === arch)) {
                    form.setFieldValue('arch', undefined);
                  }
                }}
              />
            </Form.Item>
          </div>
          <div className={styles.twoColumns}>
            <Form.Item
              name="arch"
              label={intl.formatMessage({ id: 'appVersion.arch' })}
              rules={[{ required: true, message: intl.formatMessage({ id: 'appVersion.archRequired' }) }]}
            >
              <Select
                options={archOptions(platform)}
                disabled={!platform}
                placeholder={intl.formatMessage({ id: 'appVersion.platformFirst' })}
              />
            </Form.Item>
            <Form.Item
              name="channel"
              label={intl.formatMessage({ id: 'appVersion.channel' })}
              rules={[{ required: true, message: intl.formatMessage({ id: 'appVersion.channelRequired' }) }]}
            >
              <Select options={CHANNELS} />
            </Form.Item>
          </div>

          <div className={styles.sectionTitle}>{intl.formatMessage({ id: 'appVersion.versionInfo' })}</div>
          <div className={styles.twoColumns}>
            <Form.Item
              name="appVersion"
              label={intl.formatMessage({ id: 'appVersion.version' })}
              rules={[
                { required: true, message: intl.formatMessage({ id: 'appVersion.versionRequired' }) },
                {
                  pattern: /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/,
                  message: intl.formatMessage({ id: 'appVersion.versionInvalid' }),
                },
              ]}
            >
              <Input maxLength={32} placeholder={intl.formatMessage({ id: 'appVersion.versionPlaceholder' })} />
            </Form.Item>
            <Form.Item
              name="updateType"
              label={intl.formatMessage({ id: 'appVersion.updateType' })}
              initialValue="full"
            >
              <Select options={UPDATE_TYPES} />
            </Form.Item>
          </div>
          <Form.Item name="updateMsg" label={intl.formatMessage({ id: 'appVersion.releaseNotes' })}>
            <Input.TextArea
              maxLength={2000}
              showCount
              rows={3}
              placeholder={intl.formatMessage({ id: 'appVersion.releaseNotesPlaceholder' })}
            />
          </Form.Item>

          <div className={styles.sectionTitle}>{intl.formatMessage({ id: 'appVersion.releasePolicy' })}</div>
          <div className={styles.twoColumns}>
            <Form.Item
              name="forceUpdate"
              label={intl.formatMessage({ id: 'appVersion.forceUpdate' })}
              valuePropName="checked"
              initialValue={false}
            >
              <Switch />
            </Form.Item>
            <Form.Item
              name="releaseStatus"
              label={intl.formatMessage({ id: 'appVersion.saveStatus' })}
              initialValue="draft"
            >
              <Select
                options={[
                  { value: 'draft', label: intl.formatMessage({ id: 'appVersion.saveDraft' }) },
                  { value: 'published', label: intl.formatMessage({ id: 'appVersion.publishDirectly' }) },
                ]}
              />
            </Form.Item>
          </div>

          <div className={styles.sectionTitle}>{intl.formatMessage({ id: 'appVersion.package' })}</div>
          <Space align="center" className={styles.uploadRow}>
            <Upload
              showUploadList={false}
              beforeUpload={(file) => {
                void handleUpload(file as unknown as File);
                return false;
              }}
            >
              <Button icon={<UploadOutlined />} loading={uploading}>
                {intl.formatMessage({ id: 'appVersion.upload' })}
              </Button>
            </Upload>
            {uploaded && (
              <span className={styles.muted}>
                {uploaded.fileName} · {formatBytes(uploaded.fileSize)} · sha256 {uploaded.sha256.slice(0, 12)}…
              </span>
            )}
          </Space>
          <Form.Item
            name="url"
            label={intl.formatMessage({ id: 'appVersion.downloadUrl' })}
            rules={[{ required: true, message: intl.formatMessage({ id: 'appVersion.downloadRequired' }) }]}
            extra={intl.formatMessage({ id: 'appVersion.downloadHint' })}
          >
            <Input maxLength={1000} placeholder={intl.formatMessage({ id: 'appVersion.downloadPlaceholder' })} />
          </Form.Item>
          <div className={styles.twoColumns}>
            <Form.Item name="fileName" label={intl.formatMessage({ id: 'appVersion.fileName' })}>
              <Input maxLength={255} readOnly />
            </Form.Item>
            <Form.Item name="sha256" label="SHA256">
              <Input readOnly />
            </Form.Item>
          </div>
          <Form.Item name="fileSize" hidden>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
