import { DeleteOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { useSelector } from '@umijs/max';
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

const CHANNELS = [
  { value: 'stable', label: 'stable 正式' },
  { value: 'beta', label: 'beta 公测' },
  { value: 'dev', label: 'dev 开发' },
];

const UPDATE_TYPES = [
  { value: 'full', label: 'full 全量包' },
  { value: 'incremental', label: 'incremental 增量包' },
];

const RELEASE_STATUS: Record<string, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'default' },
  published: { text: '已发布', color: 'green' },
  offline: { text: '已下线', color: 'red' },
};

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
    return <Alert type="warning" message="仅开源版 adminvip 可访问 App 版本管理。" />;
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
      message.success('安装包上传成功');
    } catch {
      message.error('安装包上传失败');
    } finally {
      setUploading(false);
    }
  };

  const changeStatus = async (item: AppVersion, action: 'publish' | 'offline') => {
    setBusyId(item.versionId);
    try {
      if (action === 'publish') {
        await publishAppVersion(item.versionId);
        message.success('版本已发布');
      } else {
        await offlineAppVersion(item.versionId);
        message.success('版本已下线');
      }
      await reload();
    } catch {
      message.error(action === 'publish' ? '发布失败' : '下线失败');
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>App 版本管理</h1>
          <p>按平台 × 架构 × 渠道维护桌面端安装包；deviceType 固定 electron，桌面端只读取已发布的最新版本。</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => edit()}>
          新建版本
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
        <Form.Item name="platform" label="平台">
          <Select allowClear placeholder="全部" style={{ width: 130 }} options={PLATFORMS} />
        </Form.Item>
        <Form.Item name="arch" label="架构">
          <Select allowClear placeholder="全部" style={{ width: 120 }} options={archOptions(platform)} />
        </Form.Item>
        <Form.Item name="channel" label="渠道">
          <Select allowClear placeholder="全部" style={{ width: 150 }} options={CHANNELS} />
        </Form.Item>
        <Form.Item name="releaseStatus" label="状态">
          <Select
            allowClear
            placeholder="全部"
            style={{ width: 120 }}
            options={Object.entries(RELEASE_STATUS).map(([value, meta]) => ({ value, label: meta.text }))}
          />
        </Form.Item>
        <Form.Item name="keyword" label="关键字">
          <Input allowClear placeholder="版本号 / 文件名" style={{ width: 200 }} />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">
              查询
            </Button>
            <Button
              onClick={() => {
                setFilters({});
                void reload(1, size, {});
              }}
            >
              重置
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
            title: '平台 / 架构',
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
            title: '版本号',
            width: 170,
            render: (_, item) => (
              <Space size={4} wrap>
                <span>{item.appVersion}</span>
                {item.updateStatus === '1' && <Tag color="red">强制更新</Tag>}
              </Space>
            ),
          },
          {
            title: '安装包',
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
            title: '状态',
            width: 100,
            render: (_, item) => {
              const meta = RELEASE_STATUS[item.releaseStatus || 'draft'] || RELEASE_STATUS.draft;
              return <Tag color={meta.color}>{meta.text}</Tag>;
            },
          },
          { title: '发布时间', dataIndex: 'publishTime', width: 180 },
          {
            title: '操作',
            width: 240,
            render: (_, item) => (
              <Space size={0} wrap>
                <Button type="link" onClick={() => edit(item)}>
                  编辑
                </Button>
                {item.releaseStatus === 'draft' && (
                  <Button
                    type="link"
                    loading={busyId === item.versionId}
                    onClick={() => void changeStatus(item, 'publish')}
                  >
                    发布
                  </Button>
                )}
                {item.releaseStatus === 'published' && (
                  <Button
                    type="link"
                    loading={busyId === item.versionId}
                    onClick={() => void changeStatus(item, 'offline')}
                  >
                    下线
                  </Button>
                )}
                {item.url && (
                  <Button type="link" href={buildPackageDownloadUrl(item.versionId)} target="_blank">
                    下载
                  </Button>
                )}
                <Popconfirm
                  title="确定删除这个版本吗？"
                  description="删除后桌面端将不再收到该版本的更新。"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={async () => {
                    setBusyId(item.versionId);
                    try {
                      await deleteAppVersion(item.versionId);
                      message.success('版本已删除');
                      await reload();
                    } catch {
                      message.error('删除失败');
                    } finally {
                      setBusyId(undefined);
                    }
                  }}
                >
                  <Button type="link" danger icon={<DeleteOutlined />}>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        className={styles.editorModal}
        title={editing ? '编辑版本' : '新建版本'}
        open={open}
        onCancel={close}
        onOk={() => form.submit()}
        confirmLoading={saving}
        width={880}
        okText={editing ? '保存版本' : '创建版本'}
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
              message.warning('请先上传安装包或填写下载地址');
              return;
            }
            savingRef.current = true;
            setSaving(true);
            try {
              if (editing) await updateAppVersion(editing.versionId, payload);
              else await createAppVersion(payload);
              message.success('版本保存成功');
              close();
              await reload(1, size, filters);
            } catch {
              message.error('版本保存失败');
            } finally {
              savingRef.current = false;
              setSaving(false);
            }
          }}
        >
          <div className={styles.sectionTitle}>归属</div>
          <div className={styles.twoColumns}>
            <Form.Item
              name="deviceType"
              label="设备类型"
              initialValue="electron"
              extra="桌面端固定发送 electron，不可修改；平台与架构请用下面两列"
            >
              <Input disabled />
            </Form.Item>
            <Form.Item name="platform" label="平台" rules={[{ required: true, message: '请选择平台' }]}>
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
            <Form.Item name="arch" label="架构" rules={[{ required: true, message: '请选择架构' }]}>
              <Select options={archOptions(platform)} disabled={!platform} placeholder="先选择平台" />
            </Form.Item>
            <Form.Item name="channel" label="渠道" rules={[{ required: true, message: '请选择渠道' }]}>
              <Select options={CHANNELS} />
            </Form.Item>
          </div>

          <div className={styles.sectionTitle}>版本信息</div>
          <div className={styles.twoColumns}>
            <Form.Item
              name="appVersion"
              label="版本号"
              rules={[
                { required: true, message: '请输入版本号' },
                { pattern: /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/, message: '版本号需形如 0.1.0 或 0.1.1-beta.2' },
              ]}
            >
              <Input maxLength={32} placeholder="例如 0.1.0" />
            </Form.Item>
            <Form.Item name="updateType" label="更新类型" initialValue="full">
              <Select options={UPDATE_TYPES} />
            </Form.Item>
          </div>
          <Form.Item name="updateMsg" label="更新说明">
            <Input.TextArea maxLength={2000} showCount rows={3} placeholder="一行一条，会原样展示在更新日志里" />
          </Form.Item>

          <div className={styles.sectionTitle}>发布策略</div>
          <div className={styles.twoColumns}>
            <Form.Item name="forceUpdate" label="强制更新" valuePropName="checked" initialValue={false}>
              <Switch />
            </Form.Item>
            <Form.Item name="releaseStatus" label="保存状态" initialValue="draft">
              <Select
                options={[
                  { value: 'draft', label: '保存为草稿（桌面端不可见）' },
                  { value: 'published', label: '直接发布' },
                ]}
              />
            </Form.Item>
          </div>

          <div className={styles.sectionTitle}>安装包</div>
          <Space align="center" className={styles.uploadRow}>
            <Upload
              showUploadList={false}
              beforeUpload={(file) => {
                void handleUpload(file as unknown as File);
                return false;
              }}
            >
              <Button icon={<UploadOutlined />} loading={uploading}>
                上传安装包
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
            label="下载地址"
            rules={[{ required: true, message: '请上传安装包或填写下载地址' }]}
            extra="上传后自动填入对象存储地址；也可以粘贴 CDN 上的外部地址"
          >
            <Input maxLength={1000} placeholder="https://… 或上传后自动生成" />
          </Form.Item>
          <div className={styles.twoColumns}>
            <Form.Item name="fileName" label="文件名">
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
