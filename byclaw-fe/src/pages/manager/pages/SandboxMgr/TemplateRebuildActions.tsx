import {
  getTemplateRebuildCapabilities,
  listTemplateRebuildRecords,
  startTemplateRebuild,
  type TemplateRebuildRecord,
} from '@/pages/manager/service/TemplateRebuild';
import { HistoryOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Modal, Space, Table, Tag, message } from 'antd';
import dayjs from 'dayjs';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef, useState } from 'react';

const errorText = (error: unknown) => (error instanceof Error ? error.message : '模板重建操作失败');
const states = {
  NEW: { text: '待构建', color: 'default' },
  BUILDING: { text: '构建中', color: 'processing' },
  SUCCEEDED: { text: '已完成', color: 'success' },
  FAILED: { text: '失败', color: 'error' },
};

export function useTemplateRebuildSupport(enabled: boolean) {
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setSupported(false);
    setError('');
    if (enabled) {
      getTemplateRebuildCapabilities()
        .then((value) => active && setSupported(value.supported === true))
        .catch(() => active && setError('暂时无法获取模板重建能力，请重新打开配置页重试'));
    }
    return () => {
      active = false;
    };
  }, [enabled]);
  return { supported, error };
}

export default function TemplateRebuildActions({ serviceKey, supported }: { serviceKey: string; supported: boolean }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [records, setRecords] = useState<TemplateRebuildRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState({ current: 1, size: 10 });
  const requestId = useRef<string>();
  const readVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++readVersion.current;
    setLoading(true);
    try {
      const result = await listTemplateRebuildRecords(serviceKey, page.current, page.size);
      if (version !== readVersion.current) return;
      setRecords(result.records);
      setTotal(result.total);
      setError('');
    } catch (failure) {
      if (version === readVersion.current) setError(errorText(failure));
    } finally {
      if (version === readVersion.current) setLoading(false);
    }
  }, [serviceKey, page]);

  useEffect(() => {
    if (!recordsOpen) return;
    void load();
    return () => {
      readVersion.current++;
    };
  }, [recordsOpen, load]);

  useEffect(() => {
    if (!recordsOpen || !records.some((record) => record.state === 'NEW' || record.state === 'BUILDING')) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(async () => {
        await load();
        if (active) schedule();
      }, 5000);
    };
    schedule();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [recordsOpen, records, load]);

  const submit = async () => {
    if (submitting) return;
    requestId.current ||= nanoid();
    setSubmitting(true);
    setError('');
    try {
      const record = await startTemplateRebuild(serviceKey, requestId.current);
      requestId.current = undefined;
      setConfirmOpen(false);
      setPage({ current: 1, size: 10 });
      setRecordsOpen(true);
      message.success(record.state === 'SUCCEEDED' ? '模板重建已完成' : '已提交模板重建，请在记录中查看进度');
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setSubmitting(false);
    }
  };

  if (!supported) return null;
  return (
    <>
      <Button
        aria-label="重建模板"
        size="small"
        type="link"
        icon={<ReloadOutlined />}
        onClick={() => {
          setError('');
          setConfirmOpen(true);
        }}
      >
        重建模板
      </Button>
      <Button
        aria-label="重建模板记录"
        size="small"
        type="link"
        icon={<HistoryOutlined />}
        onClick={() => setRecordsOpen(true)}
      >
        重建模板记录
      </Button>
      <Modal
        title="重建模板"
        open={confirmOpen}
        onOk={submit}
        okText="确认重建"
        confirmLoading={submitting}
        onCancel={() => !submitting && setConfirmOpen(false)}
        destroyOnClose
      >
        <p>确认重建 {serviceKey} 的沙箱模板？</p>
        <p>
          当前运行实例继续使用原模板。新版本就绪后，后续创建实例自动采用新版本；其他资源档位会在创建时准备对应模板。
        </p>
        {error && <Alert type="error" showIcon message={error} />}
      </Modal>
      <Modal
        title="重建模板记录"
        open={recordsOpen}
        onCancel={() => setRecordsOpen(false)}
        footer={null}
        width={1120}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Button onClick={load} loading={loading} icon={<ReloadOutlined />}>
            刷新
          </Button>
          {error && <Alert type="error" showIcon message={error} />}
          <Table<TemplateRebuildRecord>
            rowKey="id"
            loading={loading}
            dataSource={records}
            scroll={{ x: 1040 }}
            pagination={{
              current: page.current,
              pageSize: page.size,
              total,
              showSizeChanger: true,
              onChange: (current, size) => setPage({ current, size }),
              showTotal: (count) => `共 ${count} 条`,
            }}
            columns={[
              { title: '沙箱服务规格名称', dataIndex: 'serviceName', width: 180, ellipsis: true },
              { title: 'Service Key', dataIndex: 'serviceKey', width: 160, ellipsis: true },
              { title: '操作用户名称', dataIndex: 'actorName', width: 130, ellipsis: true },
              {
                title: '操作时间',
                dataIndex: 'createdAt',
                width: 180,
                render: (value) => dayjs(value).format('YYYY-MM-DD HH:mm:ss'),
              },
              { title: '资源档位', dataIndex: 'profileKey', width: 90, render: (value) => value || '默认' },
              {
                title: '状态',
                dataIndex: 'state',
                width: 90,
                render: (value: TemplateRebuildRecord['state']) => (
                  <Tag color={states[value]?.color}>{states[value]?.text || value}</Tag>
                ),
              },
              { title: '模板名称', dataIndex: 'templateName', width: 240, ellipsis: true },
              { title: '模板 ID', dataIndex: 'templateId', width: 200, ellipsis: true },
              {
                title: '结果',
                dataIndex: 'errorCode',
                width: 220,
                render: (value) => {
                  if (value === 'TEMPLATE_REBUILD_RETRYING') return '等待重试';
                  return value ? '重建失败，请检查镜像、规格或服务日志' : '-';
                },
              },
            ]}
          />
        </Space>
      </Modal>
    </>
  );
}
