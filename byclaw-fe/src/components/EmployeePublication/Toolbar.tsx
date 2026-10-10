import { history, useIntl } from '@umijs/max';
import {
  downloadPublicationSkill,
  publicationAction,
  getPublication,
  previewPublication,
  publicationUrl,
  openEmployeePublication,
  openOfficialEmployee,
  type PublicationDetail,
} from '@/service/employeePublication';
import { InfoCircleOutlined } from '@ant-design/icons';
import { Alert, Button, Input, Modal, Popover, Space, Tag, message } from 'antd';
import { useRef, useState } from 'react';
import dayjs from 'dayjs';
import { publicationErrorMessage } from '@/utils/publicationError';
import PublicationResourceSummary from './ResourceSummary';
import usePublicationConfirmation from './usePublicationConfirmation';
import UpdateTargetNotice from './UpdateTargetNotice';
import styles from './Toolbar.module.less';

type PublicationAction = 'save' | 'submit' | 'approve' | 'reject' | 'withdraw' | 'revise' | 'refreshTarget';

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
  const intl = useIntl();
  const [busyAction, setBusyAction] = useState<PublicationAction>();
  const busy = !!busyAction;
  const inFlight = useRef(false);
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const { confirmPublication, confirmationDialog } = usePublicationConfirmation();
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
        message.success(intl.formatMessage({ id: 'employeePublication.toolbar.saved' }));
        return;
      }
      if (publishing && current.dependencies.some((dependency) => dependency.error)) {
        message.error(intl.formatMessage({ id: 'employeePublication.toolbar.blocked' }));
        return;
      }
      if (publishing) {
        current = await previewPublication(current.publication);
        onChange(current);
        if ((await confirmPublication(current)) !== 'publish') return;
      }
      const next = await publicationAction(action, current.publication, { comment });
      onChange(next);
      if (action === 'submit' && next.publication.status === 'DRAFT' && next.sourceResourcesChanged) {
        message.warning(intl.formatMessage({ id: 'employeePublication.toolbar.sourceChanged' }));
        return;
      }
      if (action === 'refreshTarget') {
        message.success(intl.formatMessage({ id: 'employeePublication.toolbar.targetRefreshed' }));
        return;
      }
      if (action === 'revise') history.replace(publicationUrl(next));
      setRejecting(false);
      if (next.publication.status === 'FAILED')
        message.error(next.publication.publishError || intl.formatMessage({ id: 'employeePublication.publishFailed' }));
      else message.success(intl.formatMessage({ id: `employeePublication.status.${next.publication.status}` }));
    } catch (error: any) {
      message.error(
        publicationErrorMessage(error, intl.formatMessage({ id: 'employeePublication.toolbar.actionFailed' }))
      );
    } finally {
      inFlight.current = false;
      setBusyAction(undefined);
      onBusyChange?.(false);
    }
  };
  const blockers = detail.dependencies.filter((dependency) => dependency.error);
  // 编辑后允许先保存并重新校验，避免名称等旧校验结果阻塞提交。
  const publicationDisabled = busy || (dirty ? !detail.canEdit : blockers.length > 0);
  const reviewed = ['REJECTED', 'PUBLISHED'].includes(detail.publication.status);
  const reviewTime = (value?: string) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—');
  return (
    <div className={styles.toolbar}>
      <section className={styles.overview} aria-label={intl.formatMessage({ id: 'employeePublication.toolbar.title' })}>
        <Space wrap>
          <strong>{intl.formatMessage({ id: 'resource.publishToEnterprise' })}</strong>
          <Tag>{intl.formatMessage({ id: `employeePublication.status.${detail.publication.status}` })}</Tag>
          {detail.publication.requiresAdminVipReview && (
            <Tag color="gold">{intl.formatMessage({ id: 'employeePublication.toolbar.adminVipOnly' })}</Tag>
          )}
          <span>
            {intl.formatMessage({ id: 'employeePublication.authorLabel' })}
            {detail.publication.authorName}
          </span>
          {detail.canEdit && (
            <Button loading={busyAction === 'save'} disabled={busy} onClick={() => run('save')}>
              {intl.formatMessage({ id: 'employeePublication.toolbar.save' })}
            </Button>
          )}
          {detail.publication.status === 'APPLYING' && (
            <Button
              disabled={busy}
              onClick={() =>
                getPublication(detail.publication.requestId)
                  .then(onChange)
                  .catch((error) =>
                    message.error(
                      publicationErrorMessage(error, intl.formatMessage({ id: 'employeePublication.refreshFailed' }))
                    )
                  )
              }
            >
              {intl.formatMessage({ id: 'employeePublication.toolbar.refreshStatus' })}
            </Button>
          )}
          {detail.canSubmit && (
            <Button
              type="primary"
              loading={busyAction === 'submit'}
              disabled={publicationDisabled}
              onClick={() => run('submit')}
            >
              {intl.formatMessage({ id: 'employeePublication.toolbar.submit' })}
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
                {['FAILED', 'APPLYING'].includes(detail.publication.status)
                  ? intl.formatMessage({ id: 'employeePublication.retryPublish' })
                  : intl.formatMessage({ id: 'employeePublication.approveAndPublish' })}
              </Button>
              <Button disabled={busy} onClick={() => setRejecting(true)}>
                {intl.formatMessage({ id: 'employeePublication.toolbar.reject' })}
              </Button>
            </>
          )}
          {detail.canRevise && (
            <Button loading={busyAction === 'revise'} disabled={busy} onClick={() => run('revise')}>
              {intl.formatMessage({ id: 'employeePublication.toolbar.reapply' })}
            </Button>
          )}
          {['REJECTED', 'WITHDRAWN'].includes(detail.publication.status) && !detail.canRevise && (
            <Button
              disabled={busy}
              onClick={() =>
                openEmployeePublication(detail.publication.sourceId).catch((error) =>
                  message.error(
                    publicationErrorMessage(
                      error,
                      intl.formatMessage({ id: 'employeePublication.toolbar.openLatestFailed' })
                    )
                  )
                )
              }
            >
              {intl.formatMessage({ id: 'employeePublication.toolbar.viewLatest' })}
            </Button>
          )}
          {detail.publication.status === 'PUBLISHED' && detail.publication.officialId && (
            <>
              <Button onClick={() => openOfficialEmployee(detail.publication.officialId!)}>
                {intl.formatMessage({ id: 'employeePublication.toolbar.viewOfficial' })}
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  openEmployeePublication(detail.publication.sourceId, 'publishUpdate').catch((error) =>
                    message.error(
                      publicationErrorMessage(
                        error,
                        intl.formatMessage({ id: 'employeePublication.toolbar.updateFailed' })
                      )
                    )
                  )
                }
              >
                {intl.formatMessage({ id: 'employeePublication.toolbar.publishUpdate' })}
              </Button>
            </>
          )}
          {detail.canWithdraw && (
            <Button disabled={busy} onClick={() => run('withdraw')}>
              {intl.formatMessage({ id: 'employeePublication.toolbar.withdraw' })}
            </Button>
          )}
          {dirty && <span>{intl.formatMessage({ id: 'employeePublication.toolbar.dirtyHint' })}</span>}
        </Space>
        <div className={styles.policy}>
          <InfoCircleOutlined />
          <span>
            {detail.canEdit
              ? intl.formatMessage({ id: 'employeePublication.toolbar.editHint' })
              : intl.formatMessage({ id: 'employeePublication.toolbar.readOnlyHint' })}
          </span>
          <Popover
            trigger="click"
            placement="bottomLeft"
            title={intl.formatMessage({ id: 'employeePublication.toolbar.rulesTitle' })}
            content={
              <div className={styles.rules}>{intl.formatMessage({ id: 'employeePublication.toolbar.rules' })}</div>
            }
          >
            <Button type="link" size="small">
              {intl.formatMessage({ id: 'employeePublication.toolbar.viewRules' })}
            </Button>
          </Popover>
        </div>
      </section>
      {detail.sourceResourcesChanged && detail.canSubmit && (
        <Alert
          showIcon
          type="info"
          style={{ marginTop: 8 }}
          message={intl.formatMessage({ id: 'employeePublication.toolbar.synced' })}
        />
      )}
      <UpdateTargetNotice
        detail={detail}
        busy={busy || dirty}
        onRefresh={detail.canEdit || detail.canReview ? () => run('refreshTarget') : undefined}
      />
      {reviewed && (
        <Alert
          style={{ marginTop: 8 }}
          showIcon
          type={detail.publication.status === 'REJECTED' ? 'warning' : 'success'}
          message={
            detail.publication.status === 'REJECTED'
              ? intl.formatMessage({ id: 'employeePublication.toolbar.rejected' })
              : intl.formatMessage({ id: 'employeePublication.toolbar.approved' })
          }
          description={
            <>
              <div>
                {intl.formatMessage({ id: 'employeePublication.reviewerLabel' })}
                {detail.publication.reviewerName || '—'}
              </div>
              <div>
                {intl.formatMessage({ id: 'employeePublication.reviewTimeLabel' })}
                {reviewTime(detail.publication.reviewedAt)}
              </div>
              <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {detail.publication.status === 'REJECTED'
                  ? intl.formatMessage({ id: 'employeePublication.toolbar.rejectReasonLabel' })
                  : intl.formatMessage({ id: 'employeePublication.toolbar.reviewNotesLabel' })}
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
          message={intl.formatMessage({ id: 'employeePublication.toolbar.previousComment' })}
          description={
            <>
              <div>
                {intl.formatMessage({ id: 'employeePublication.reviewerLabel' })}
                {detail.previousReview.reviewerName || '—'}
              </div>
              <div>
                {intl.formatMessage({ id: 'employeePublication.reviewTimeLabel' })}
                {reviewTime(detail.previousReview.reviewedAt)}
              </div>
              <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {intl.formatMessage({ id: 'employeePublication.toolbar.rejectReasonLabel' })}
                {detail.previousReview.comment || '—'}
              </div>
              <Button
                type="link"
                disabled={busy || dirty}
                title={dirty ? intl.formatMessage({ id: 'employeePublication.toolbar.saveBeforePrevious' }) : undefined}
                onClick={() =>
                  getPublication(detail.previousReview!.requestId)
                    .then((previous) => history.push(publicationUrl(previous)))
                    .catch((error) =>
                      message.error(
                        publicationErrorMessage(
                          error,
                          intl.formatMessage({ id: 'employeePublication.toolbar.openPreviousFailed' })
                        )
                      )
                    )
                }
              >
                {intl.formatMessage({ id: 'employeePublication.toolbar.viewPrevious' })}
              </Button>
            </>
          }
        />
      )}
      {(blockers.length > 0 || detail.publication.publishError) && (
        <Alert
          style={{ marginTop: 8 }}
          showIcon
          type="warning"
          message={
            detail.publication.publishError || intl.formatMessage({ id: 'employeePublication.toolbar.adjustRequired' })
          }
          description={blockers.map((dependency, index) => (
            <div key={`${dependency.resourceId}-${index}`}>
              {dependency.name}：{dependency.error}
            </div>
          ))}
        />
      )}
      <PublicationResourceSummary
        key={detail.publication.requestId}
        dependencies={detail.dependencies.filter((dependency) => !dependency.error)}
        onDownloadSkill={(dependency) =>
          downloadPublicationSkill(detail.publication.requestId, dependency.resourceId).catch((error) =>
            message.error(
              publicationErrorMessage(error, intl.formatMessage({ id: 'employeePublication.toolbar.downloadFailed' }))
            )
          )
        }
      />
      {confirmationDialog}
      <Modal
        title={intl.formatMessage({ id: 'employeePublication.toolbar.rejectTitle' })}
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
          placeholder={intl.formatMessage({ id: 'employeePublication.toolbar.rejectPlaceholder' })}
        />
      </Modal>
    </div>
  );
}
