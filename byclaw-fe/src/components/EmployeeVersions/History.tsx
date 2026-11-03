import { v4 as uuidv4 } from 'uuid';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, Empty, List, Modal, Space, Spin, Tag, message } from 'antd';
import { history } from '@umijs/max';
import {
  activateEmployeeVersion,
  getEmployeeVersions,
  retryEmployeeVersion,
  versionCompareUrl,
  type EmployeeVersionHistory,
  type EmployeeVersion,
} from '@/service/employeeVersions';
import { publicationErrorMessage } from '@/utils/publicationError';

export default function EmployeeVersionHistoryPanel({
  resourceId,
  onChanged,
}: {
  resourceId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<EmployeeVersionHistory>();
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const load = async () => {
    const current = ++sequence.current;
    setBusy(true);
    setError('');
    try {
      const response = await getEmployeeVersions(resourceId, page);
      if (current === sequence.current) setData(response);
    } catch (e) {
      if (current === sequence.current) setError(publicationErrorMessage(e, '版本历史加载失败'));
    } finally {
      if (current === sequence.current) setBusy(false);
    }
  };
  useEffect(() => {
    if (open) load();
    return () => {
      sequence.current += 1;
    };
  }, [open, resourceId, page]);
  const activate = (version: EmployeeVersion) => {
    if (!data) return;
    Modal.confirm({
      title: data.requiresReview ? `申请将 V${version.number} 设为生效版本` : `将 V${version.number} 设为生效版本`,
      content: data.requiresReview
        ? '需所有已发布组织审核通过后统一更新，审核期间继续使用当前版本。'
        : '新请求将使用所选配置；权限、组织范围、凭证及用户私有记忆保持当前设置。',
      onOk: async () => {
        setBusy(true);
        try {
          const result = await activateEmployeeVersion({
            resourceId,
            versionId: version.id,
            expectedRevision: data.revision,
            requestId: uuidv4(),
          });
          if (result.publicationId) {
            history.push(
              `/digitalEmployeesCreate?appId=${encodeURIComponent(resourceId)}&publicationId=${
                result.publicationId
              }&log=false&manage=false`
            );
          } else {
            if (result.status === 'SYNC_FAILED') message.warning('配置已生效，运行态同步失败，请重试同步');
            else message.success('生效版本已切换');
            onChanged();
            await load();
          }
        } catch (e) {
          message.error(publicationErrorMessage(e, '版本切换失败'));
          throw e;
        } finally {
          setBusy(false);
        }
      },
    });
  };
  const retry = async () => {
    setBusy(true);
    try {
      await retryEmployeeVersion(resourceId);
      await load();
      onChanged();
    } catch (e) {
      message.error(publicationErrorMessage(e, '同步失败'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        onClick={() => {
          setPage(1);
          setOpen(true);
        }}
      >
        版本历史
      </Button>
      <Drawer title="数字员工版本历史" width={650} open={open} onClose={() => setOpen(false)}>
        <Alert
          type="info"
          showIcon
          message="每次保存产生不可变配置版本。历史不包含授权、组织范围、连接凭证、知识内容或用户私有记忆；关联资源使用当前可用内容。"
          style={{ marginBottom: 16 }}
        />
        {error && <Alert type="error" message={error} action={<Button onClick={load}>重试</Button>} />}
        {data?.syncStatus && !['READY', 'ACTIVE'].includes(data.syncStatus) && (
          <Alert
            type="warning"
            message={data.syncError || '运行态待同步'}
            action={
              <Button disabled={busy} onClick={retry}>
                重试同步
              </Button>
            }
          />
        )}
        <Spin spinning={busy}>
          <List
            dataSource={data?.versions || []}
            locale={{ emptyText: <Empty description="暂无版本" /> }}
            renderItem={(version) => (
              <List.Item
                actions={[
                  <Button
                    key="compare"
                    type="link"
                    disabled={!data?.activeVersionId}
                    onClick={() => history.push(versionCompareUrl(resourceId, data!.activeVersionId, version.id))}
                  >
                    对比
                  </Button>,
                  <Button
                    key="activate"
                    type="link"
                    disabled={busy || version.active}
                    onClick={() => activate(version)}
                  >
                    {version.active ? '当前生效' : data?.requiresReview ? '申请生效' : '设为生效'}
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      V{version.number}
                      <span>{version.name}</span>
                      {version.active && <Tag color="green">生效中</Tag>}
                      {version.latest && <Tag>最新保存</Tag>}
                    </Space>
                  }
                  description={
                    <>
                      <div>
                        {version.createdAt} · 保存人：{version.authorId}
                      </div>
                      <div>{version.note || (version.source === 'BASELINE' ? '上线时当前配置基线' : '保存配置')}</div>
                    </>
                  }
                />
              </List.Item>
            )}
          />
        </Spin>
        <Space>
          <Button disabled={busy || page === 1} onClick={() => setPage(page - 1)}>
            上一页
          </Button>
          <span>第 {page} 页</span>
          <Button disabled={busy || (data?.versions.length || 0) < 20} onClick={() => setPage(page + 1)}>
            下一页
          </Button>
        </Space>
      </Drawer>
    </>
  );
}
