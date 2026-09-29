import React from 'react';

import { getUsedModelFromMetadata } from '../../utils';
import { thinkingLevelLabel } from '@/utils/thinkingLevel';
import styles from '../../index.module.less';

type Props = {

  /** 助手消息 metadata JSON 字符串，后端在 metadata.usedModel 写入本轮实际使用的模型。 */
  metadata?: string;
};

/**
 * 每轮助手回答末尾的模型角标；metadata 缺失或没有可用名称/编码时不渲染。
 * 后端记录了本轮思考强度档位时，在模型名后追加档位（如「深入」）。
 */
const UsedModelBadge: React.FC<Props> = ({ metadata }) => {
  const usedModel = getUsedModelFromMetadata(metadata);
  if (!usedModel) return null;
  const label = usedModel.name || usedModel.code;

  // off 是绝大多数模型的常态（含无 reasoning 能力的模型），角标只在非 off 档位时追加标签。
  const levelLabel =
    usedModel.thinkingLevel && usedModel.thinkingLevel !== 'off' ? thinkingLevelLabel(usedModel.thinkingLevel) : '';
  const title = usedModel.code ? `${label}（${usedModel.code}）` : label;
  return (
    <div
      className={styles.modelBadge}
      title={levelLabel ? `${title} · ${levelLabel}` : title}
      data-testid="used-model-badge"
    >
      <span>{levelLabel ? `${label} · ${levelLabel}` : label}</span>
    </div>
  );
};

export default UsedModelBadge;
