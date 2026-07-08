import React, { useMemo } from 'react';
import { Collapse } from 'antd';
import type { CollapseProps } from 'antd';
import type { EmployeeResourceGroup } from './types';
import styles from './index.module.less';

interface Props {
  groups: EmployeeResourceGroup[];
  maxItems?: number;
  listClassName?: string;
  expandAllByDefault?: boolean;
  renderList: (list: any[], renderItem: (item: any) => React.ReactNode, className?: string) => React.ReactNode;
  renderItem: (item: any, group: EmployeeResourceGroup) => React.ReactNode;
}

const KnowledgeResourceGroupedContent = ({
  groups,
  maxItems,
  listClassName,
  expandAllByDefault,
  renderList,
  renderItem,
}: Props) => {
  const visibleGroups = useMemo(() => groups.filter((group) => group.list.length > 0), [groups]);

  const renderGroupLabel = (group: EmployeeResourceGroup) => (
    <span className="ub ub-ac">
      {group.title}
      {group.description ? <span className={styles.resourceGroupTitleTip}>{group.description}</span> : null}
    </span>
  );

  const displayGroups = useMemo(() => {
    if (!maxItems || maxItems <= 0) {
      return visibleGroups;
    }

    let remaining = maxItems;
    const nextGroups: EmployeeResourceGroup[] = [];
    visibleGroups.forEach((group) => {
      if (remaining <= 0) {
        return;
      }
      const list = group.list.slice(0, remaining);
      remaining -= list.length;
      if (list.length) {
        nextGroups.push({
          ...group,
          list,
        });
      }
    });
    return nextGroups;
  }, [maxItems, visibleGroups]);

  const collapseItems = useMemo<CollapseProps['items']>(
    () =>
      displayGroups.map((group) => ({
        key: group.key,
        label: renderGroupLabel(group),
        children: renderList(
          group.list,
          (item) => renderItem(item, group),
          listClassName || styles.knowledgeResourceList
        ),
      })),
    [displayGroups, listClassName, renderItem, renderList]
  );

  const defaultActiveKey = useMemo(() => {
    if (expandAllByDefault) {
      return displayGroups.map((group) => group.key);
    }
    const currentGroup = displayGroups.find((group) => group.key === 'current');
    return currentGroup ? [currentGroup.key] : [];
  }, [displayGroups, expandAllByDefault]);

  if (!displayGroups.length) {
    return null;
  }

  return (
    <Collapse
      className={styles.knowledgeResourceCollapse}
      defaultActiveKey={defaultActiveKey}
      ghost
      items={collapseItems}
    />
  );
};

export default KnowledgeResourceGroupedContent;
