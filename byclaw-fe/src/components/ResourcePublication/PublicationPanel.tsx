import { nanoid } from 'nanoid';
import {
  currentPublication,
  publicationAction,
  publicationDetail,
  publicationSnapshot,
  scopeFromIds,
  validPublishScope,
  type PublicationDetail,
  type PublishScope,
  type ScopeLabel,
} from '@/service/resourcePublication';
import { publicationErrorMessage } from '@/utils/publicationError';
import { getIntl, useIntl } from '@umijs/max';
import { Alert, Button, Checkbox, Input, message, Modal, Select, Space, Spin, Table, Tag } from 'antd';
import { useEffect, useState } from 'react';
import ScopeSelector from './ScopeSelector';

export function ScopeTags({ mode, scopes = [] }: { mode?: string; scopes?: ScopeLabel[] }) {
  const intl = useIntl();
  return (
    <>
      {scopes.length ? (
        scopes.map((o) => (
          <Tag key={o.orgId}>{o.orgId === '-1' ? intl.formatMessage({ id: 'rp.company' }) : o.orgName}</Tag>
        ))
      ) : (
        <Tag>{intl.formatMessage({ id: `rp.mode.${mode || 'LEGACY'}` })}</Tag>
      )}
    </>
  );
}

export default function PublicationPanel({
  resourceId,
  requestId,
  onChange,
  onRepublish,
}: {
  resourceId?: string;
  requestId?: string;
  onChange?: () => void;
  onRepublish?: () => void;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id: `rp.${id}` });
  const [detail, setDetail] = useState<PublicationDetail>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scope, setScope] = useState<PublishScope>({ mode: 'COMPANY' });
  const [operation, setOperation] = useState('REPLACE_SCOPE');
  const [selected, setSelected] = useState<string[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = requestId ? await publicationDetail(requestId) : await currentPublication(resourceId!);
      setDetail(data);
      if (data.publication?.status === 'DRAFT')
        setScope(scopeFromIds(JSON.parse(data.publication.requestedScopeJson).map(String)));
      setSelected(data.targets.filter((row) => row.canReview).map((row) => row.target.orgId));
      setRemove([]);
    } catch (e) {
      setError(publicationErrorMessage(e, t('failed')));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [resourceId, requestId]);
  const act = async (action: Parameters<typeof publicationAction>[0], extra: any = {}) => {
    setLoading(true);
    try {
      const data = await publicationAction(action, {
        resourceId: resourceId || detail?.publication?.resourceId,
        requestId: detail?.publication?.requestId,
        revision: detail?.publication?.revision,
        scopeRevision: detail?.scopeRevision,
        comment,
        ...extra,
      });
      setDetail(data);
      setSelected(data.targets.filter((row) => row.canReview).map((row) => row.target.orgId));
      setRemove([]);
      onChange?.();
      message.success(t('saved'));
    } catch (e) {
      message.error(publicationErrorMessage(e, t('failed')));
    } finally {
      setLoading(false);
    }
  };
  if (error) return <Alert type="error" message={error} action={<Button onClick={load}>{t('reload')}</Button>} />;
  if (!detail) return <Spin />;
  const draft = detail.publication?.status === 'DRAFT';
  const active = draft || detail.publication?.status === 'PENDING';
  const snapshot = publicationSnapshot(detail);
  return (
    <Spin spinning={loading}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Alert type="info" message={t('notice')} />
        {snapshot.resourceName && <strong>{snapshot.resourceName}</strong>}
        {snapshot.resourceDesc && <p>{snapshot.resourceDesc}</p>}
        <div>
          {t('effective')}: <ScopeTags mode={detail.scopeMode} scopes={detail.publishedScope} />
        </div>
        <div>
          {t('controller')}: {t(`controller.${detail.scopeController || 'BYAI'}`)}
        </div>
        {detail.publication && (
          <div>
            {t('request')}: {detail.publication.requestId} · {t(`status.${detail.publication.status}`)}
          </div>
        )}
        {!!detail.targets.length && (
          <Table
            size="small"
            pagination={false}
            rowKey={(row) => row.target.orgId}
            dataSource={detail.targets}
            rowSelection={
              detail.canReview
                ? {
                  selectedRowKeys: selected,
                  onChange: (keys) => setSelected(keys.map(String)),
                  getCheckboxProps: (row) => ({ disabled: !row.canReview }),
                }
                : undefined
            }
            columns={[
              {
                title: t('scope'),
                render: (_, row) => (row.target.orgId === '-1' ? t('company') : row.target.orgNameSnapshot),
              },
              {
                title: t('result'),
                render: (_, row) =>
                  `${t(`status.${row.target.status}`)}${
                    row.target.status === 'APPROVED' && !row.target.appliedAt ? ` (${t('waitingReplacement')})` : ''
                  }`,
              },
              { title: t('comment'), render: (_, row) => row.target.comment || '—' },
            ]}
          />
        )}
        {onRepublish &&
          !active &&
          detail.scopeMode === 'NONE' &&
          detail.targets.length > 0 &&
          detail.targets.every((row) => ['REJECTED', 'CANCELLED'].includes(row.target.status)) && (
          <Button type="primary" onClick={onRepublish}>
            {t('republishCopy')}
          </Button>
        )}
        {detail.canManage && (!active || draft) && (
          <>
            {!active && (
              <Select
                value={operation}
                style={{ width: 220 }}
                onChange={setOperation}
                options={['ADD_SCOPE', 'REPLACE_SCOPE'].map((value) => ({ value, label: t(`operation.${value}`) }))}
              />
            )}
            <ScopeSelector value={scope} onChange={setScope} />
            <Button
              disabled={!validPublishScope(scope)}
              onClick={() =>
                act(draft ? 'save' : 'prepare', {
                  operation: ['COMPANY', 'ORGS'].includes(detail.scopeMode) ? operation : 'PUBLISH',
                  publishScope: scope,
                  idempotencyKey: nanoid(),
                })
              }
            >
              {t(draft ? 'saveDraft' : 'prepare')}
            </Button>
            {detail.canSubmit && (
              <Button
                type="primary"
                onClick={async () => {
                  setLoading(true);
                  try {
                    const saved = await publicationAction('save', {
                      requestId: detail.publication!.requestId,
                      revision: detail.publication!.revision,
                      publishScope: scope,
                    });
                    await act('submit', {
                      requestId: saved.publication!.requestId,
                      revision: saved.publication!.revision,
                    });
                  } catch (e) {
                    message.error(publicationErrorMessage(e, t('failed')));
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={!validPublishScope(scope)}
              >
                {t('submit')}
              </Button>
            )}
          </>
        )}
        {(detail.canReview || detail.canWithdraw) && (
          <Input.TextArea
            value={comment}
            maxLength={2000}
            placeholder={t('comment')}
            onChange={(e) => setComment(e.target.value)}
          />
        )}
        <Space>
          {detail.canReview && (
            <>
              <Button
                type="primary"
                disabled={!selected.length}
                onClick={() => act('review', { approved: true, targetOrgIds: selected })}
              >
                {t('approve')}
              </Button>
              <Button
                danger
                disabled={!selected.length}
                onClick={() => act('review', { approved: false, targetOrgIds: selected })}
              >
                {t('reject')}
              </Button>
            </>
          )}
          {detail.canWithdraw && <Button onClick={() => act('withdraw')}>{t('withdraw')}</Button>}
        </Space>
        {detail.canManage && !active && !!detail.publishedScope.length && (
          <>
            <Checkbox.Group
              value={remove}
              options={detail.publishedScope.map((o) => ({
                value: o.orgId,
                label: o.orgId === '-1' ? t('company') : o.orgName,
              }))}
              onChange={(ids) => setRemove(ids.map(String))}
            />
            <Button
              danger
              disabled={!remove.length}
              onClick={() =>
                Modal.confirm({
                  title: t('retractConfirm'),
                  onOk: () => act('retract', { targetOrgIds: remove, idempotencyKey: nanoid() }),
                })
              }
            >
              {t('retract')}
            </Button>
          </>
        )}
      </Space>
    </Spin>
  );
}

export const openResourcePublication = (props: Parameters<typeof PublicationPanel>[0]) => {
  const dialog = Modal.info({
    title: getIntl().formatMessage({ id: 'rp.manage' }),
    width: 760,
    icon: null,
    maskClosable: true,
    content: (
      <PublicationPanel
        {...props}
        onRepublish={
          props.onRepublish
            ? () => {
              dialog.destroy();
              props.onRepublish?.();
            }
            : undefined
        }
      />
    ),
  });
  return dialog;
};
