import React from 'react';
import type { ITreeData } from '@/pages/manager/pages/OrgMgr/components/TreeFilter';
import TreeFilter from '@/pages/manager/pages/OrgMgr/components/TreeFilter';
import styles from '../index.module.less';

type IntlShape = {
  formatMessage: (descriptor: { id: string }, values?: Record<string, any>) => string;
};

type Props = {
  intl: IntlShape;
  modelTypeTreeData: ITreeData[];
  modelTypeSelectedList: ITreeData[];
  onModelTypeOk: (list: ITreeData[]) => void;
  statusTreeData: ITreeData[];
  abilityTreeData: ITreeData[];
  systemTreeData: ITreeData[];
  statusSelectedList: ITreeData[];
  abilitySelectedList: ITreeData[];
  systemSelectedList: ITreeData[];
  onStatusOk: (list: ITreeData[]) => void;
  onAbilityOk: (list: ITreeData[]) => void;
  onSystemOk: (list: ITreeData[]) => void;
};

const ModelFilterPanel: React.FC<Props> = ({
  intl,
  modelTypeTreeData,
  modelTypeSelectedList,
  onModelTypeOk,
  statusTreeData,
  abilityTreeData,
  systemTreeData,
  statusSelectedList,
  abilitySelectedList,
  systemSelectedList,
  onStatusOk,
  onAbilityOk,
  onSystemOk,
}) => {
  return (
    <div className={styles.filterPanel}>
      {/* 复用原版筛选组件，恢复悬停浮窗、双列选项及选中后的清除交互。 */}
      <div className={styles.filterRow}>
        {[
          { key: 'ModelType', options: modelTypeTreeData, selected: modelTypeSelectedList, onChange: onModelTypeOk },
          { key: 'Ability', options: abilityTreeData, selected: abilitySelectedList, onChange: onAbilityOk },
          { key: 'Status', options: statusTreeData, selected: statusSelectedList, onChange: onStatusOk },
          { key: 'System', options: systemTreeData, selected: systemSelectedList, onChange: onSystemOk },
        ].map((group) => (
          <div
            key={group.key}
            className={styles.filterField}
            role="group"
            aria-label={intl.formatMessage({ id: `modelMgr.filter${group.key}` })}
          >
            <TreeFilter
              title={intl.formatMessage({ id: `modelMgr.filter${group.key}` })}
              treeData={group.options}
              selectedList={group.selected}
              onOk={group.onChange}
              previewMaxWidth={420}
              previewItemMaxWidth={140}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default ModelFilterPanel;
