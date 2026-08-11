import React, { useEffect, useRef, useState } from 'react';
import { Button, Empty, Modal, Spin, message } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import useGlobal from '@/hooks/useGlobal';
import {
  executeInstallSkillGroup,
  getSkillGroupDetail,
  preflightInstallSkillGroup,
} from '@/pages/manager/service/resources';
import type {
  SkillGroup,
  SkillGroupInstallParams,
  SkillGroupInstallResult,
  SkillGroupMember,
  SkillGroupMemberStatus,
  SkillGroupMemberStatusSummary,
} from '@/pages/manager/service/resources';
import type { IMessage } from '@/typescript/message';
import { getFileUrl } from '@/utils/file';
import { getSkillGroupDefaultCover } from '../skillGroupCover';
import styles from './index.module.less';

type DrawerMessage = Partial<IMessage> & {
  messageId: string;
};

export interface SkillGroupDetailDrawerProps {
  groupId?: string;
  digitalEmployeeId?: string;
  onClose?: () => void;
  onUpdateMessage?: (payload: DrawerMessage) => void;
  onCreateMessage?: (payload: DrawerMessage) => void;
}

type SkillGroupDetail = SkillGroup & {
  catalogName?: string;
  creatorName?: string;
  createUserName?: string;
  description?: string;
};

const getResponseData = (response: any): SkillGroupDetail | null =>
  response && Object.prototype.hasOwnProperty.call(response, 'data') ? response.data : response || null;

const memberStatusMessageIds: Record<SkillGroupMemberStatus, string> = {
  INSTALLED: 'resource.skillGroup.memberStatus.installed',
  INSTALLABLE: 'resource.skillGroup.memberStatus.installable',
  APPLY_REQUIRED: 'resource.skillGroup.memberStatus.applyRequired',
  APPLY_PENDING: 'resource.skillGroup.memberStatus.applyPending',
  APPLY_UNAVAILABLE: 'resource.skillGroup.memberStatus.unavailable',
};

const memberStatusClassNames: Record<SkillGroupMemberStatus, string> = {
  INSTALLED: 'statusInstalled',
  INSTALLABLE: 'statusInstallable',
  APPLY_REQUIRED: 'statusApplyRequired',
  APPLY_PENDING: 'statusApplyPending',
  APPLY_UNAVAILABLE: 'statusUnavailable',
};

const SkillGroupDetailDrawer: React.FC<SkillGroupDetailDrawerProps> = ({ groupId, digitalEmployeeId, onClose }) => {
  const intl = useIntl();
  const { EventEmitter } = useGlobal();
  const [detail, setDetail] = useState<SkillGroupDetail | null>(null);
  const [loading, setLoading] = useState(Boolean(groupId));
  const [error, setError] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [confirmSummary, setConfirmSummary] = useState<SkillGroupMemberStatusSummary | null>(null);
  const [installError, setInstallError] = useState(false);
  const [posterError, setPosterError] = useState(false);
  const mountedRef = useRef(true);
  const installIdentityRef = useRef({ groupId, digitalEmployeeId });

  useEffect(() => {
    installIdentityRef.current = { groupId, digitalEmployeeId };
    setInstalling(false);
    setInstallError(false);
    setConfirmSummary(null);
  }, [digitalEmployeeId, groupId]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    if (!groupId) {
      setDetail(null);
      setLoading(false);
      setError(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setError(false);
    void getSkillGroupDetail({ groupId, digitalEmployeeId })
      .then((response) => {
        if (!active) return;
        setDetail(getResponseData(response));
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [digitalEmployeeId, groupId]);

  useEffect(() => {
    setPosterError(false);
  }, [detail?.avatar]);

  const isCurrentInstall = (installIdentity: SkillGroupInstallParams) =>
    mountedRef.current &&
    installIdentityRef.current.groupId === installIdentity.groupId &&
    installIdentityRef.current.digitalEmployeeId === installIdentity.digitalEmployeeId;

  const applyInstallResult = (result: SkillGroupInstallResult) => {
    if (result.summary?.members) {
      const summaryMembers = result.summary.members;
      setDetail((currentDetail) => {
        if (!currentDetail) return currentDetail;
        return { ...currentDetail, members: summaryMembers };
      });
    }

    const installedSkillIds = Array.isArray(result.installedSkillIds) ? result.installedSkillIds : [];
    const existingSkillIds = Array.isArray(result.existingSkillIds) ? result.existingSkillIds : [];

    EventEmitter.emit('beyond-resourceList-resourceType-reload', {
      resourceType: 'SKILL',
      resetSkillFilters: false,
    });
    [...installedSkillIds, ...existingSkillIds].forEach((resourceId) => {
      window.dispatchEvent(new CustomEvent('digitalEmployeeResourceInstalled', { detail: { resourceId } }));
    });

    const summaryMembers = result.summary?.members || [];
    const allInstalled =
      summaryMembers.length > 0 && summaryMembers.every((member) => member.memberStatus === 'INSTALLED');
    message.success(
      intl.formatMessage({
        id: allInstalled ? 'resource.installSkillGroupSuccess' : 'resource.skillGroup.installProcessed',
      })
    );
  };

  const executeInstall = async (installIdentity: SkillGroupInstallParams) => {
    setInstalling(true);
    setInstallError(false);
    setConfirmSummary(null);
    try {
      const result = await executeInstallSkillGroup(installIdentity);
      if (!isCurrentInstall(installIdentity)) return;

      applyInstallResult(result);
    } catch {
      if (!isCurrentInstall(installIdentity)) return;

      setInstallError(true);
      message.error(intl.formatMessage({ id: 'common.operationFailed' }));
    } finally {
      if (isCurrentInstall(installIdentity)) setInstalling(false);
    }
  };

  const handleInstall = async () => {
    if (!groupId || !digitalEmployeeId || installing) return;

    const installIdentity = { groupId, digitalEmployeeId };

    setInstalling(true);
    setInstallError(false);
    try {
      const summary = await preflightInstallSkillGroup(installIdentity);
      if (!isCurrentInstall(installIdentity)) return;

      if (summary.applyRequired > 0 || summary.applyPending > 0 || summary.unavailable > 0) {
        setConfirmSummary(summary);
        return;
      }
      await executeInstall(installIdentity);
    } catch {
      if (!isCurrentInstall(installIdentity)) return;

      setInstallError(true);
      message.error(intl.formatMessage({ id: 'common.operationFailed' }));
    } finally {
      if (isCurrentInstall(installIdentity)) setInstalling(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.state} data-testid="skill-group-detail-loading">
        <Spin />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.state} data-testid="skill-group-detail-error">
        {intl.formatMessage({ id: 'common.operationFailed' })}
      </div>
    );
  }

  if (!detail) {
    return (
      <div className={styles.state} data-testid="skill-group-detail-empty">
        <Empty description={intl.formatMessage({ id: 'common.none' })} />
      </div>
    );
  }

  const resourceName = detail.resourceName || intl.formatMessage({ id: 'common.none' });
  const creator = detail.creatorName || detail.createUserName || detail.createBy;
  const category = detail.catalogName || detail.catalogId;
  const description = detail.resourceDesc || detail.description;
  const members = Array.isArray(detail.members) ? detail.members : [];
  const allMembersInstalled = members.length > 0 && members.every((member) => member.memberStatus === 'INSTALLED');

  const renderMemberStatus = (member: SkillGroupMember) => {
    if (!member.memberStatus) return null;

    return (
      <span className={`${styles.memberStatus} ${styles[memberStatusClassNames[member.memberStatus]]}`}>
        {intl.formatMessage({ id: memberStatusMessageIds[member.memberStatus] })}
      </span>
    );
  };

  const renderConfirmMembers = (statuses: SkillGroupMemberStatus[]) => {
    const matchedMembers = confirmSummary?.members.filter(
      (member) => member.memberStatus && statuses.includes(member.memberStatus)
    );
    if (!matchedMembers?.length) return null;

    return (
      <ul className={styles.confirmMemberList}>
        {matchedMembers.map((member) => (
          <li key={member.resourceId}>
            <span>{member.resourceName}</span>
            {renderMemberStatus(member)}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className={styles.drawer}>
      <aside className={styles.visualPane}>
        <button
          type="button"
          className={styles.backButton}
          aria-label={intl.formatMessage({ id: 'common.back' })}
          onClick={onClose}
        >
          <ArrowLeftOutlined />
        </button>
        <div className={styles.posterFrame}>
          {detail.avatar && !posterError ? (
            <img
              className={styles.poster}
              src={getFileUrl(detail.avatar)}
              alt={resourceName}
              onError={() => setPosterError(true)}
            />
          ) : (
            <img
              className={styles.posterDefault}
              data-testid="skill-group-detail-default-cover"
              src={getSkillGroupDefaultCover()}
              alt=""
            />
          )}
        </div>
      </aside>

      <main className={styles.detailPane}>
        <header className={styles.summary}>
          <h1>{resourceName}</h1>
          <div className={styles.metaRow}>
            <span>{creator || intl.formatMessage({ id: 'common.none' })}</span>
            <i />
            <span>{category || intl.formatMessage({ id: 'common.none' })}</span>
          </div>
          <Button
            className={styles.installButton}
            type="primary"
            disabled={!digitalEmployeeId || installing || allMembersInstalled}
            loading={installing}
            onClick={handleInstall}
          >
            {intl.formatMessage({
              id: allMembersInstalled ? 'resource.skillGroup.installed' : 'resource.installSkillGroup',
            })}
          </Button>
          {installError ? (
            <div className={styles.installError} data-testid="skill-group-detail-install-error">
              {intl.formatMessage({ id: 'common.operationFailed' })}
            </div>
          ) : null}
        </header>

        <section className={styles.section}>
          <h2>{intl.formatMessage({ id: 'resource.description' })}</h2>
          <p>{description || intl.formatMessage({ id: 'common.none' })}</p>
        </section>

        <section className={styles.section}>
          <h2>
            {intl.formatMessage({ id: 'resource.memberSkills' })}
            <span className={styles.memberCount}>（{members.length}）</span>
          </h2>
          {members.length ? (
            <ul className={styles.memberList}>
              {members.map((member) => (
                <li key={member.resourceId}>
                  <div className={styles.memberHeader}>
                    <span className={styles.memberName}>{member.resourceName}</span>
                    {renderMemberStatus(member)}
                  </div>
                  {member.resourceDesc ? <small>{member.resourceDesc}</small> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>{intl.formatMessage({ id: 'common.none' })}</p>
          )}
        </section>
      </main>

      <Modal
        open={Boolean(confirmSummary)}
        title={intl.formatMessage({ id: 'resource.skillGroup.installConfirmTitle' })}
        okText={intl.formatMessage({ id: 'common.confirm' })}
        cancelText={intl.formatMessage({ id: 'common.cancel' })}
        confirmLoading={installing}
        onCancel={() => setConfirmSummary(null)}
        onOk={() => {
          if (groupId && digitalEmployeeId) void executeInstall({ groupId, digitalEmployeeId });
        }}
        destroyOnHidden
      >
        {confirmSummary ? (
          <div className={styles.confirmContent}>
            <p>{intl.formatMessage({ id: 'resource.skillGroup.installConfirmDescription' })}</p>
            <div className={styles.confirmStats}>
              <strong>
                {intl.formatMessage(
                  { id: 'resource.skillGroup.installableCount' },
                  { count: confirmSummary.installable }
                )}
              </strong>
              <strong>
                {intl.formatMessage(
                  { id: 'resource.skillGroup.applyRequiredCount' },
                  { count: confirmSummary.applyRequired + confirmSummary.applyPending }
                )}
              </strong>
              <strong>
                {intl.formatMessage(
                  { id: 'resource.skillGroup.unavailableCount' },
                  { count: confirmSummary.unavailable }
                )}
              </strong>
            </div>
            {renderConfirmMembers(['INSTALLABLE'])}
            {renderConfirmMembers(['APPLY_REQUIRED', 'APPLY_PENDING'])}
            {renderConfirmMembers(['APPLY_UNAVAILABLE'])}
          </div>
        ) : null}
      </Modal>
    </div>
  );
};

export default SkillGroupDetailDrawer;
