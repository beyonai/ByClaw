import type { PublicationDetail } from '@/service/employeePublication';
import { useIntl } from '@umijs/max';
import { Alert, Button, Collapse, Modal, Typography } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import ResourceAvailabilityList, { resourceIsOmitted } from './ResourceAvailabilityList';
import UpdateTargetNotice from './UpdateTargetNotice';

type Decision = 'publish' | 'edit' | 'cancel';

export default function usePublicationConfirmation(mode: 'publish' | 'update' = 'publish') {
  const intl = useIntl();
  const updating = mode === 'update';
  const [candidate, setCandidate] = useState<PublicationDetail>();
  const resolveRef = useRef<(decision: Decision) => void>();
  useEffect(
    () => () => {
      resolveRef.current?.('cancel');
      resolveRef.current = undefined;
    },
    []
  );
  const settle = (decision: Decision) => {
    const resolve = resolveRef.current;
    resolveRef.current = undefined;
    setCandidate(undefined);
    resolve?.(decision);
  };
  const confirmPublication = useCallback((detail: PublicationDetail) => {
    if (resolveRef.current) return Promise.resolve<Decision>('cancel');
    setCandidate(detail);
    return new Promise<Decision>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);
  const omitted = candidate?.dependencies.filter(resourceIsOmitted) || [];
  const retained = candidate?.dependencies.filter((dependency) => !resourceIsOmitted(dependency)) || [];
  const warnings = retained.filter((dependency) => dependency.warning);
  const others = retained.filter((dependency) => !dependency.warning);
  const noWarningsDescription = others.length
    ? intl.formatMessage({ id: 'employeePublication.confirm.noWarnings' })
    : intl.formatMessage({ id: 'employeePublication.confirm.noResources' });
  let summaryMessage = intl.formatMessage(
    { id: 'employeePublication.confirm.ready' },
    {
      v0: updating
        ? intl.formatMessage({ id: 'employeePublication.confirm.submitAction' })
        : intl.formatMessage({ id: 'employeePublication.confirm.publishAction' }),
    }
  );
  let summaryDescription = noWarningsDescription;
  if (warnings.length) {
    summaryMessage = intl.formatMessage(
      { id: 'employeePublication.confirm.warnings' },
      {
        v0: updating
          ? intl.formatMessage({ id: 'employeePublication.confirm.submitAction' })
          : intl.formatMessage({ id: 'employeePublication.confirm.publishAction' }),
        v1: warnings.length,
      }
    );
    summaryDescription = intl.formatMessage({ id: 'employeePublication.confirm.warningDescription' });
  }
  if (omitted.length) {
    summaryMessage = intl.formatMessage(
      { id: 'employeePublication.confirm.omissions' },
      { v0: retained.length, v1: omitted.length }
    );
    summaryDescription = intl.formatMessage({ id: 'employeePublication.confirm.omissionDescription' });
  }
  const confirmationDialog = (
    <Modal
      title={
        updating
          ? intl.formatMessage({ id: 'employeePublication.confirm.updateTitle' })
          : intl.formatMessage({ id: 'employeePublication.publishToEnterpriseConfirm' })
      }
      open={!!candidate}
      width={760}
      style={{ maxWidth: 'calc(100vw - 32px)' }}
      styles={{ body: { maxHeight: '60vh', overflow: 'auto' } }}
      maskClosable={false}
      onCancel={() => settle('cancel')}
      footer={[
        <Button key="edit" onClick={() => settle('edit')}>
          {intl.formatMessage({ id: 'employeePublication.confirm.backToEdit' })}
        </Button>,
        <Button
          key="publish"
          type="primary"
          disabled={candidate?.updateTarget?.changed}
          onClick={() => settle('publish')}
        >
          {updating
            ? intl.formatMessage({ id: 'employeePublication.confirm.submitUpdate' })
            : intl.formatMessage({ id: 'employeePublication.confirm.publish' })}
        </Button>,
      ]}
    >
      {candidate && (
        <>
          <Typography.Paragraph style={{ overflowWrap: 'anywhere' }}>
            <strong>{candidate.publication.employeeName}</strong>
            <br />
            <Typography.Text type="secondary">
              {updating
                ? intl.formatMessage({ id: 'employeePublication.confirm.updateHint' })
                : intl.formatMessage({ id: 'employeePublication.confirm.publishHint' })}
            </Typography.Text>
          </Typography.Paragraph>
          <UpdateTargetNotice detail={candidate} />
          {candidate.sourceResourcesChanged && (
            <Alert
              showIcon
              type="info"
              style={{ marginBottom: 16 }}
              message={intl.formatMessage({ id: 'employeePublication.confirm.sourceChanged' })}
            />
          )}
          <Alert
            showIcon
            type={omitted.length || warnings.length ? 'warning' : 'success'}
            style={{ marginBottom: 16 }}
            message={summaryMessage}
            description={summaryDescription}
          />
          {omitted.length > 0 && <ResourceAvailabilityList dependencies={omitted} />}
          {warnings.length > 0 && (
            <>
              <Typography.Paragraph strong style={{ marginTop: 16 }}>
                {intl.formatMessage({ id: 'employeePublication.confirm.restrictedCount' }, { count: warnings.length })}
              </Typography.Paragraph>
              <ResourceAvailabilityList dependencies={warnings} />
            </>
          )}
          {others.length > 0 && (
            <Collapse
              key={candidate.publication.requestId}
              ghost
              style={{ marginTop: warnings.length ? 12 : 0 }}
              items={[
                {
                  key: 'others',
                  label: intl.formatMessage(
                    { id: 'employeePublication.confirm.otherResources' },
                    {
                      v0: warnings.length
                        ? intl.formatMessage({ id: 'employeePublication.confirm.remaining' })
                        : intl.formatMessage({ id: 'employeePublication.confirm.linked' }),
                      v1: others.length,
                    }
                  ),
                  children: <ResourceAvailabilityList dependencies={others} />,
                },
              ]}
            />
          )}
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            {updating
              ? intl.formatMessage({ id: 'employeePublication.confirm.updateDraftHint' })
              : intl.formatMessage({ id: 'employeePublication.confirm.savedHint' })}
            {intl.formatMessage({ id: 'employeePublication.confirm.resourcePolicy' })}
          </Typography.Paragraph>
        </>
      )}
    </Modal>
  );
  return { confirmPublication, confirmationDialog };
}
