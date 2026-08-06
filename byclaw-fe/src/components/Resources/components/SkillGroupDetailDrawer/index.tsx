import React, { useEffect, useRef, useState } from 'react';
import { Button, Empty, Spin, message } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import useGlobal from '@/hooks/useGlobal';
import { getSkillGroupDetail, installSkillGroup } from '@/pages/manager/service/resources';
import type { SkillGroup, SkillGroupInstallResult } from '@/pages/manager/service/resources';
import type { IMessage } from '@/typescript/message';
import { SKILL_GROUP_DEFAULT_COVER } from '../skillGroupCover';
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

const SkillGroupDetailDrawer: React.FC<SkillGroupDetailDrawerProps> = ({ groupId, digitalEmployeeId, onClose }) => {
  const intl = useIntl();
  const { EventEmitter } = useGlobal();
  const [detail, setDetail] = useState<SkillGroupDetail | null>(null);
  const [loading, setLoading] = useState(Boolean(groupId));
  const [error, setError] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState(false);
  const [posterError, setPosterError] = useState(false);
  const mountedRef = useRef(true);
  const installIdentityRef = useRef({ groupId, digitalEmployeeId });

  useEffect(() => {
    installIdentityRef.current = { groupId, digitalEmployeeId };
    setInstalling(false);
    setInstallError(false);
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
    void getSkillGroupDetail({ groupId })
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
  }, [groupId]);

  useEffect(() => {
    setPosterError(false);
  }, [detail?.avatar]);

  const handleInstall = async () => {
    if (!groupId || !digitalEmployeeId || installing) return;

    const installIdentity = { groupId, digitalEmployeeId };
    const isCurrentInstall = () =>
      mountedRef.current &&
      installIdentityRef.current.groupId === installIdentity.groupId &&
      installIdentityRef.current.digitalEmployeeId === installIdentity.digitalEmployeeId;

    setInstalling(true);
    setInstallError(false);
    try {
      const result: SkillGroupInstallResult = await installSkillGroup({ groupId, digitalEmployeeId });
      if (!isCurrentInstall()) return;

      const installedSkillIds = Array.isArray(result.installedSkillIds) ? result.installedSkillIds : [];
      const existingSkillIds = Array.isArray(result.existingSkillIds) ? result.existingSkillIds : [];

      EventEmitter.emit('beyond-resourceList-resourceType-reload', {
        resourceType: 'SKILL',
        resetSkillFilters: false,
      });
      [...installedSkillIds, ...existingSkillIds].forEach((resourceId) => {
        window.dispatchEvent(new CustomEvent('digitalEmployeeResourceInstalled', { detail: { resourceId } }));
      });
      message.success(intl.formatMessage({ id: 'resource.installSkillGroupSuccess' }));
    } catch {
      if (!isCurrentInstall()) return;

      setInstallError(true);
      message.error(intl.formatMessage({ id: 'common.operationFailed' }));
    } finally {
      if (isCurrentInstall()) setInstalling(false);
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
              src={detail.avatar}
              alt={resourceName}
              onError={() => setPosterError(true)}
            />
          ) : (
            <img
              className={styles.posterDefault}
              data-testid="skill-group-detail-default-cover"
              src={SKILL_GROUP_DEFAULT_COVER}
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
            disabled={!digitalEmployeeId || installing}
            loading={installing}
            onClick={handleInstall}
          >
            {intl.formatMessage({ id: 'resource.installSkillGroup' })}
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
                  <span>{member.resourceName}</span>
                  {member.resourceDesc ? <small>{member.resourceDesc}</small> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>{intl.formatMessage({ id: 'common.none' })}</p>
          )}
        </section>
      </main>
    </div>
  );
};

export default SkillGroupDetailDrawer;
