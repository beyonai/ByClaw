import { Button, Popconfirm, Tag } from 'antd';
import classNames from 'classnames';
import dayjs from 'dayjs';
import React from 'react';
import styles from '../index.module.less';
import { getModelTypeName, renderAbilityTags, renderStatusTag, type ModelStatus } from './modelMgrViewUtils';

type Props = {
  intl: any;
  record: any;
  abilityLabelMap: Record<string, string>;
  modelTypeLabelMap?: Record<string, string>;
  onSetStatus: (record: any, nextStatus: ModelStatus) => void;
  onSetDefault: (record: any) => void;
  onEdit: (record: any) => void;
  onDebug: (record: any) => void;
  onDelete: (record: any) => void;
};

const ModelCardItem: React.FC<Props> = ({
  intl,
  record,
  abilityLabelMap,
  modelTypeLabelMap,
  onSetStatus,
  onSetDefault,
  onEdit,
  onDebug,
  onDelete,
}) => {
  const {
    modelType,
    displayName,
    status: recordStatus,
    modelCode,
    providerName,
    contextTokens,
    abilities: abilitiesArr,
    updatedAt,
    isDefault,
  } = record || {};
  const isBackendDefaultModel = isDefault === 1 || isDefault === true || isDefault === '1';
  // 所有类型均可设置默认，以后端默认标记为准，不依赖对话能力标签。
  const canSetDefault = recordStatus === 'ENABLED' && !isBackendDefaultModel;

  let statusActions: Array<{
    status: Extract<ModelStatus, 'ENABLED' | 'DISABLED'>;
    label: string;
    confirmText: string;
  }>;

  if (recordStatus === 'TESTING') {
    statusActions = [
      {
        status: 'ENABLED',
        label: intl.formatMessage({ id: 'modelMgr.statusEnabled' }),
        confirmText: intl.formatMessage({ id: 'modelMgr.confirmEnable' }),
      },
      {
        status: 'DISABLED',
        label: intl.formatMessage({ id: 'modelMgr.statusDisabled' }),
        confirmText: intl.formatMessage({ id: 'modelMgr.confirmDisable' }),
      },
    ];
  } else {
    const isEnabled = recordStatus === 'ENABLED';
    statusActions = [
      {
        status: isEnabled ? 'DISABLED' : 'ENABLED',
        label: intl.formatMessage({ id: isEnabled ? 'modelMgr.statusDisabled' : 'modelMgr.statusEnabled' }),
        confirmText: intl.formatMessage({ id: isEnabled ? 'modelMgr.confirmDisable' : 'modelMgr.confirmEnable' }),
      },
    ];
  }

  return (
    <div className={styles.cardItem}>
      <div className={styles.cardAccent} />
      <div className={styles.cardHead}>
        <div className={styles.titleBlock}>
          <div className={classNames(styles.title, 'ellipsis')} title={displayName}>
            {displayName || '-'}
          </div>
          <div className={styles.subtitleRow}>
            <span className={styles.modelPill}>{getModelTypeName(intl, modelType, modelTypeLabelMap)}</span>
            <span className={classNames(styles.provider, 'ellipsis')} title={providerName}>
              {providerName || '-'}
            </span>
          </div>
        </div>
        <div className={styles.cardStatusGroup}>
          {/* 展示当前类型的默认模型，涵盖语音、重排、图片等非对话类型。 */}
          {isBackendDefaultModel ? (
            <Tag className={styles.defaultBadge}>{intl.formatMessage({ id: 'modelMgr.defaultModel' })}</Tag>
          ) : null}
          {recordStatus ? renderStatusTag(intl, recordStatus) : null}
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.metaGrid}>
          <div className={styles.metaCard}>
            <div className={styles.metaLabel}>{intl.formatMessage({ id: 'modelMgr.modelCode' })}</div>
            <div className={classNames(styles.metaValue, 'ellipsis')} title={modelCode}>
              {modelCode || '-'}
            </div>
          </div>
          <div className={styles.metaCard}>
            <div className={styles.metaLabel}>{intl.formatMessage({ id: 'modelMgr.context' })}</div>
            <div className={styles.metaValue}>{contextTokens ? `${contextTokens} tokens` : '-'}</div>
          </div>
        </div>

        {/* 卡片仅展示应用范围，系统标签仍用于筛选和表单配置。 */}
        <div className={styles.section}>
          <div className={styles.sectionLabel}>{intl.formatMessage({ id: 'modelMgr.filterAbility' })}</div>
          <div className={styles.tagRow}>
            {Array.isArray(abilitiesArr) && abilitiesArr.length ? (
              renderAbilityTags(abilitiesArr, abilityLabelMap)
            ) : (
              <span className={styles.emptyText}>-</span>
            )}
          </div>
        </div>
      </div>

      <div className={styles.cardBottom}>
        <div className={classNames(styles.cardInfo, 'ellipsis')} title={updatedAt}>
          {intl.formatMessage({ id: 'modelMgr.lastUpdate' })}：
          {updatedAt ? dayjs(updatedAt).format('YYYY-MM-DD HH:mm') : '-'}
        </div>

        <div className={styles.btnGroup}>
          {statusActions.map((action) => (
            <Popconfirm
              key={action.status}
              title={action.confirmText}
              onConfirm={(e) => {
                e?.stopPropagation?.();
                onSetStatus(record, action.status);
              }}
              onCancel={(e) => e?.stopPropagation?.()}
            >
              <Button
                type="link"
                className={styles.button}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
              >
                {action.label}
              </Button>
            </Popconfirm>
          ))}

          <Button
            type="link"
            className={styles.button}
            onClick={(e) => {
              e.stopPropagation();
              onEdit(record);
            }}
          >
            {intl.formatMessage({ id: 'common.edit' })}
          </Button>

          <Button
            type="link"
            className={styles.button}
            onClick={(e) => {
              e.stopPropagation();
              onDebug(record);
            }}
          >
            {intl.formatMessage({ id: 'modelMgr.debug' })}
          </Button>

          {canSetDefault ? (
            <Popconfirm
              title={intl.formatMessage({ id: 'modelMgr.confirmSetDefault' })}
              onConfirm={(e) => {
                e?.stopPropagation?.();
                onSetDefault(record);
              }}
              onCancel={(e) => e?.stopPropagation?.()}
            >
              <Button
                type="link"
                className={styles.button}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
              >
                {intl.formatMessage({ id: 'modelMgr.setDefault' })}
              </Button>
            </Popconfirm>
          ) : null}

          <Popconfirm
            title={intl.formatMessage({ id: 'modelMgr.confirmDelete' })}
            onConfirm={(e) => {
              e?.stopPropagation?.();
              onDelete(record);
            }}
            onCancel={(e) => e?.stopPropagation?.()}
          >
            <Button
              type="link"
              danger
              className={styles.dangerBtn}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
            >
              {intl.formatMessage({ id: 'common.delete' })}
            </Button>
          </Popconfirm>
        </div>
      </div>
    </div>
  );
};

export default ModelCardItem;
