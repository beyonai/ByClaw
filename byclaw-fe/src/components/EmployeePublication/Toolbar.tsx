import { history } from '@umijs/max';
import {
  downloadPublicationSkill,
  publicationAction,
  getPublication,
  publicationUrl,
  publicationStatus,
  openEmployeePublication,
  openOfficialEmployee,
  type PublicationDetail,
} from '@/service/employeePublication';
import { Alert, Button, Input, Modal, Space, Tag, message } from 'antd';
import { useRef, useState } from 'react';
import dayjs from 'dayjs';

type PublicationAction = 'save' | 'submit' | 'approve' | 'reject' | 'withdraw' | 'revise';

export default function PublicationToolbar({
  detail,
  dirty,
  onChange,
  onSave,
  onBusyChange,
}: {
  detail: PublicationDetail;
  dirty: boolean;
  onChange: (value: PublicationDetail) => void;
  onSave: () => Promise<PublicationDetail | undefined>;
  onBusyChange?: (value: boolean) => void;
}) {
  const [busyAction, setBusyAction] = useState<PublicationAction>();
  const busy = !!busyAction;
  const inFlight = useRef(false);
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const run = async (action: PublicationAction) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusyAction(action);
    onBusyChange?.(true);
    try {
      let current = detail;
      const publishing = action === 'submit' || action === 'approve';
      if (action === 'save' || (publishing && dirty)) {
        if (!current.canEdit) return;
        const saved = await onSave();
        // 表单校验失败时不继续提交，也不使用旧修订号发布。
        if (!saved) return;
        current = saved;
        onChange(saved);
      }
      if (action === 'save') {
        message.success('待发布配置已保存');
        return;
      }
      if (publishing && current.dependencies.some((dependency) => dependency.error)) {
        message.error('关联资源尚未满足发布条件，请处理页面提示后再提交');
        return;
      }
      const next = await publicationAction(action, current.publication, { comment });
      onChange(next);
      if (action === 'revise') history.replace(publicationUrl(next));
      setRejecting(false);
      if (next.publication.status === 'FAILED') message.error(next.publication.publishError || '发布失败');
      else message.success(publicationStatus[next.publication.status]);
    } catch (error: any) {
      message.error(error?.message || '保存或操作失败，请刷新后重试');
    } finally {
      inFlight.current = false;
      setBusyAction(undefined);
      onBusyChange?.(false);
    }
  };
  const blockers = detail.dependencies.filter((dependency) => dependency.error);
  // 编辑后允许先保存并重新校验，避免已移除的私有资源仍被旧校验结果阻塞。
  const publicationDisabled = busy || (dirty ? !detail.canEdit : blockers.length > 0);
  const reviewed = ['REJECTED', 'PUBLISHED'].includes(detail.publication.status);
  const reviewTime = (value?: string) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—');
  return (
    <div style={{ padding: '12px 24px' }}>
      <Space wrap>
        <strong>发布到官方推荐</strong>
        <Tag>{publicationStatus[detail.publication.status]}</Tag>
        <span>创建者：{detail.publication.authorName}</span>
        {detail.canEdit && (
          <Button loading={busyAction === 'save'} disabled={busy} onClick={() => run('save')}>
            保存待发布配置
          </Button>
        )}
        {detail.publication.status === 'APPLYING' && (
          <Button
            disabled={busy}
            onClick={() =>
              getPublication(detail.publication.requestId)
                .then(onChange)
                .catch(() => message.error('刷新失败'))
            }
          >
            刷新状态
          </Button>
        )}
        {detail.canSubmit && (
          <Button
            type="primary"
            loading={busyAction === 'submit'}
            disabled={publicationDisabled}
            onClick={() => run('submit')}
          >
            提交发布
          </Button>
        )}
        {detail.canReview && (
          <>
            <Button
              type="primary"
              loading={busyAction === 'approve'}
              disabled={publicationDisabled}
              onClick={() => run('approve')}
            >
              {['FAILED', 'APPLYING'].includes(detail.publication.status) ? '重试发布' : '通过并发布'}
            </Button>
            <Button disabled={busy} onClick={() => setRejecting(true)}>
              驳回
            </Button>
          </>
        )}
        {detail.canRevise && (
          <Button loading={busyAction === 'revise'} disabled={busy} onClick={() => run('revise')}>
            修改并重新申请
          </Button>
        )}
        {['REJECTED', 'WITHDRAWN'].includes(detail.publication.status) && !detail.canRevise && (
          <Button
            disabled={busy}
            onClick={() =>
              openEmployeePublication(detail.publication.sourceId).catch(() => message.error('打开最新申请失败'))
            }
          >
            查看最新申请
          </Button>
        )}
        {detail.publication.status === 'PUBLISHED' && detail.publication.officialId && (
          <Button onClick={() => openOfficialEmployee(detail.publication.officialId!)}>查看官方副本</Button>
        )}
        {detail.canWithdraw && (
          <Button disabled={busy} onClick={() => run('withdraw')}>
            撤回申请
          </Button>
        )}
        {dirty && <span>有未保存的修改，提交发布或通过审核时将自动保存。</span>}
      </Space>
      {reviewed && (
        <Alert
          style={{ marginTop: 8 }}
          showIcon
          type={detail.publication.status === 'REJECTED' ? 'warning' : 'success'}
          message={detail.publication.status === 'REJECTED' ? '审核结果：已驳回' : '审核结果：已通过并发布'}
          description={
            <>
              <div>审核人：{detail.publication.reviewerName || '—'}</div>
              <div>审核时间：{reviewTime(detail.publication.reviewedAt)}</div>
              <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {detail.publication.status === 'REJECTED' ? '驳回原因' : '审核说明'}：
                {detail.publication.comment || '—'}
              </div>
            </>
          }
        />
      )}
      {detail.previousReview && (
        <Alert
          style={{ marginTop: 8 }}
          showIcon
          type="warning"
          message="上次审核意见"
          description={
            <>
              <div>审核人：{detail.previousReview.reviewerName || '—'}</div>
              <div>审核时间：{reviewTime(detail.previousReview.reviewedAt)}</div>
              <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                驳回原因：{detail.previousReview.comment || '—'}
              </div>
              <Button
                type="link"
                disabled={busy || dirty}
                title={dirty ? '请先保存当前修改，再查看上次审核记录' : undefined}
                onClick={() =>
                  getPublication(detail.previousReview!.requestId)
                    .then((previous) => history.push(publicationUrl(previous)))
                    .catch(() => message.error('打开上次审核记录失败'))
                }
              >
                查看上次审核记录
              </Button>
            </>
          }
        />
      )}
      <Alert
        style={{ marginTop: 8 }}
        type={blockers.length || detail.publication.publishError ? 'warning' : 'info'}
        showIcon
        message={
          detail.publication.publishError ||
          (detail.canEdit
            ? '本页编辑待发布版本。审核通过后创建或更新官方副本，原个人员工不变。'
            : '本页展示该次申请的配置，审核记录保留。')
        }
        description={
          <>
            <div>
              面向当前企业全员共享；个人技能复制为独立快照，已公开资源复用。个人记忆、聊天记录和机器人渠道不参与发布。
            </div>
            {detail.dependencies.map((dependency) => (
              <div key={dependency.resourceId}>
                {dependency.name}：
                {dependency.error || (dependency.action === 'COPY_SKILL' ? '复制技能快照' : '复用企业公共资源')}
                {dependency.action === 'COPY_SKILL' && (
                  <Button
                    type="link"
                    onClick={() =>
                      downloadPublicationSkill(detail.publication.requestId, dependency.resourceId).catch(() =>
                        message.error('下载技能快照失败')
                      )
                    }
                  >
                    下载待审技能
                  </Button>
                )}
              </div>
            ))}
          </>
        }
      />
      <Modal
        title="驳回发布申请"
        open={rejecting}
        onCancel={() => !busy && setRejecting(false)}
        onOk={() => run('reject')}
        confirmLoading={busyAction === 'reject'}
        okButtonProps={{ disabled: busy || !comment.trim() }}
        cancelButtonProps={{ disabled: busy }}
      >
        <Input.TextArea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          maxLength={2000}
          placeholder="请填写驳回原因"
        />
      </Modal>
    </div>
  );
}
