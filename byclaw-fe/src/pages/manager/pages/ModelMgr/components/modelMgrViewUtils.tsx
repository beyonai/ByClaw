import { Tag } from 'antd';
import classNames from 'classnames';
import React from 'react';
import styles from '../index.module.less';

type IntlShape = {
  formatMessage: (descriptor: { id: string }, values?: Record<string, any>) => string;
};

export type ModelStatus = 'ENABLED' | 'DISABLED' | 'TESTING';

export type FilterChip = {
  key: string;
  label: string;
  onClose: () => void;
};

export const systemNameMap: Record<string, string> = {
  super_assistant: 'modelMgr.system.superAssistant',
  chatbi: 'chatbi',
  aiwrite: 'aiwrite',
};

export const getSystemName = (intl: IntlShape, value: string) => {
  const fallback = systemNameMap[value] || value;
  if (fallback.startsWith('modelMgr.')) {
    return intl.formatMessage({ id: fallback });
  }
  return fallback;
};

export const getTagTone = (value: string) => {
  const lower = `${value || ''}`.toLowerCase();
  if (lower.includes('chat') || lower.includes('llm') || lower.includes('dialog')) return 'blue';
  if (lower.includes('rerank') || lower.includes('search') || lower.includes('retrieval')) return 'green';
  if (lower.includes('write') || lower.includes('content')) return 'orange';
  return 'slate';
};

export const renderStatusTag = (intl: IntlShape, status: ModelStatus) => {
  if (status === 'ENABLED') {
    return <Tag color="success">{intl.formatMessage({ id: 'modelMgr.statusEnabled' })}</Tag>;
  }
  if (status === 'TESTING') {
    return <Tag color="warning">{intl.formatMessage({ id: 'modelMgr.statusTesting' })}</Tag>;
  }
  return <Tag>{intl.formatMessage({ id: 'modelMgr.statusDisabled' })}</Tag>;
};

export const renderAbilityTags = (abilities: any[], abilityLabelMap: Record<string, string>) => {
  const arr = Array.isArray(abilities) ? abilities : [];
  return (
    <>
      {arr.map((item) => {
        const label = abilityLabelMap?.[`${item}`] || item;
        const iconText = `${label}`.trim().slice(0, 2).toUpperCase();
        return (
          <Tag key={`ab_${item}`} className={classNames(styles.enhancedTag, styles[`tagTone${getTagTone(`${item}`)}`])}>
            <span className={styles.tagIcon}>{iconText || 'AI'}</span>
            {label}
          </Tag>
        );
      })}
    </>
  );
};

export const renderSystemTags = (intl: IntlShape, systems: any[], systemLabelMap: Record<string, string> = {}) => {
  const arr = Array.isArray(systems) ? systems : [];
  return (
    <>
      {arr.map((item) => {
        const label = systemLabelMap?.[`${item}`] || getSystemName(intl, `${item}`);
        const iconText = `${label}`.trim().slice(0, 2).toUpperCase();
        return (
          <Tag key={`sys_${item}`} className={classNames(styles.enhancedTag, styles.tagToneslate)}>
            <span className={styles.tagIcon}>{iconText || 'SY'}</span>
            {label}
          </Tag>
        );
      })}
    </>
  );
};
