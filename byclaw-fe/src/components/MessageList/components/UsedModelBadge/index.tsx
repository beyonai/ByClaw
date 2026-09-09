import React from 'react';

import { getUsedModelFromMetadata } from '../../utils';
import styles from '../../index.module.less';

type Props = {
  /** 助手消息 metadata JSON 字符串，后端在 metadata.usedModel 写入本轮实际使用的模型。 */
  metadata?: string;
};

/**
 * 每轮助手回答末尾的模型角标；metadata 缺失或没有可用名称/编码时不渲染。
 */
const UsedModelBadge: React.FC<Props> = ({ metadata }) => {
  const usedModel = getUsedModelFromMetadata(metadata);
  if (!usedModel) return null;
  const label = usedModel.name || usedModel.code;
  return (
    <div className={styles.modelBadge} title={usedModel.code ? `${label}（${usedModel.code}）` : label}>
      <span>{label}</span>
    </div>
  );
};

export default UsedModelBadge;
