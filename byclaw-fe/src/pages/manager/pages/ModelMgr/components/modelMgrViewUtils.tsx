import { Tag } from 'antd';
import classNames from 'classnames';
import React from 'react';
import styles from '../index.module.less';

type IntlShape = {
  formatMessage: (descriptor: { id: string }, values?: Record<string, any>) => string;
};

export type ModelStatus = 'ENABLED' | 'DISABLED' | 'TESTING';

const MODEL_TYPE_CODES = new Set(['LLM', 'RERANK', 'EMBEDDING', 'TTS', 'IMAGE_GENERATION']);

export const getModelTypeName = (intl: IntlShape, value?: string | null, labels: Record<string, string> = {}) => {
  const code = value?.trim().toUpperCase() || '';
  if (!code) return '-';
  // 卡片使用不带编码的名称；字典扩展类型沿用配置名称，缺失名称时不直接展示编码。
  if (MODEL_TYPE_CODES.has(code)) {
    return intl.formatMessage({ id: `modelMgr.typeName.${code}` });
  }
  const label = labels[code]?.trim();
  return label && label.toUpperCase() !== code ? label : intl.formatMessage({ id: 'modelMgr.typeName.unknown' });
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
