import { Tag } from 'antd';
import React from 'react';
import type { IntlShape } from 'react-intl';
import type { ITreeData } from '@/pages/manager/pages/OrgMgr/components/TreeFilter';
import TreeFilter from '@/pages/manager/pages/OrgMgr/components/TreeFilter';
import type { FilterChip } from './modelMgrViewUtils';
import styles from '../index.module.less';

type Props = {
  intl: IntlShape;
  resultSummary: string;
  statusTreeData: ITreeData[];
  abilityTreeData: ITreeData[];
  systemTreeData: ITreeData[];
  statusSelectedList: ITreeData[];
  abilitySelectedList: ITreeData[];
  systemSelectedList: ITreeData[];
  filterChips: FilterChip[];
  onStatusOk: (list: ITreeData[]) => void;
  onAbilityOk: (list: ITreeData[]) => void;
  onSystemOk: (list: ITreeData[]) => void;
};

const ModelFilterPanel: React.FC<Props> = ({
  intl,
  resultSummary,
  statusTreeData,
  abilityTreeData,
  systemTreeData,
  statusSelectedList,
  abilitySelectedList,
  systemSelectedList,
  filterChips,
  onStatusOk,
  onAbilityOk,
  onSystemOk,
}) => {
  return (
    <div className={styles.filterPanel}>
      <div className={styles.filterHeader}>
        <div className={styles.filterTitle}>{intl.formatMessage({ id: 'modelMgr.filterTitle' })}</div>
        <div className={styles.filterSummary}>{resultSummary}</div>
      </div>

      <div className={styles.filterRow}>
        <TreeFilter
          title={intl.formatMessage({ id: 'modelMgr.filterStatus' })}
          treeData={statusTreeData}
          selectedList={statusSelectedList}
          onOk={onStatusOk}
        />
        <TreeFilter
          title={intl.formatMessage({ id: 'modelMgr.filterAbility' })}
          treeData={abilityTreeData}
          selectedList={abilitySelectedList}
          onOk={onAbilityOk}
        />
        <TreeFilter
          title={intl.formatMessage({ id: 'modelMgr.filterSystem' })}
          treeData={systemTreeData}
          selectedList={systemSelectedList}
          onOk={onSystemOk}
        />
      </div>

      {!!filterChips.length && (
        <div className={styles.filterChips}>
          {filterChips.map((chip) => (
            <Tag key={chip.key} closable onClose={chip.onClose} className={styles.filterChip}>
              {chip.label}
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
};

export default ModelFilterPanel;
