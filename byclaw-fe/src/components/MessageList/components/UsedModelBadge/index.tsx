import { useIntl } from '@umijs/max';
import React from 'react';

import { getUsedModelFromMetadata } from '../../utils';
import { thinkingLevelLabel } from '@/utils/thinkingLevel';
import styles from '../../index.module.less';

/** 助手消息 metadata JSON 字符串，后端在 metadata.usedModel 写入本轮实际使用的模型。 */
type Props = {
  metadata?: string;
};

/**
 * 每轮助手回答末尾的模型角标；metadata 缺失或没有可用名称/编码时不渲染。
 * 后端记录了本轮思考强度档位时，在模型名后追加档位（如「深入」）。
 */
const UsedModelBadge: React.FC<Props> = ({ metadata }) => {
  const intl = useIntl();
  let routing: { mode?: string; fallback?: boolean } | undefined;
  try {
    routing = metadata ? JSON.parse(metadata).modelRouting : undefined;
  } catch {
    routing = undefined;
  }
  const usedModel = getUsedModelFromMetadata(metadata);
  if (!usedModel) return null;
  const baseLabel = usedModel.name || usedModel.code;
  const label = routing?.mode === 'auto' ? `Auto · ${baseLabel}` : baseLabel;

  // off 是绝大多数模型的常态（含无 reasoning 能力的模型），角标只在非 off 档位时追加标签。
  const levelLabel =
    usedModel.thinkingLevel && usedModel.thinkingLevel !== 'off' ? thinkingLevelLabel(usedModel.thinkingLevel) : '';
  const title = usedModel.code ? `${label}（${usedModel.code}）` : label;
  const titleWithLevel = levelLabel ? `${title} · ${levelLabel}` : title;
  const tooltip = routing?.fallback
    ? `${titleWithLevel} · ${intl.formatMessage({ id: 'ui.model.auto.fallback' })}`
    : titleWithLevel;
  return (
    <div className={styles.modelBadge} title={tooltip} data-testid="used-model-badge">
      <span>{levelLabel ? `${label} · ${levelLabel}` : label}</span>
    </div>
  );
};

export default UsedModelBadge;
