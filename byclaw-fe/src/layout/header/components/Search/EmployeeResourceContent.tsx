import React from 'react';
import KnowledgeBaseDetail from '@/layout/sider/components/Knowledge/components/KnowledgeBase/KnowledgeBaseDetail';
import type { IKnowledgeBaseItem } from '@/layout/sider/components/Knowledge/components/KnowledgeBase/types';
import KnowledgeResourceGroupedContent from './KnowledgeResourceGroupedContent';
import type { KnowledgeResourceGroup } from './types';
import styles from './index.module.less';

interface Props {
  tabKey: string;
  list: any[];
  knowledgeResourceGroups: KnowledgeResourceGroup[];
  employeeResourceGroups: KnowledgeResourceGroup[];
  expandAllGroupsByDefault?: boolean;
  currentKnowledgeBase: IKnowledgeBaseItem | null;
  activeSiderAgentResourceId?: string;
  renderList: (list: any[], renderItem: (item: any) => React.ReactNode, className?: string) => React.ReactNode;
  renderItemKnowledgeBase: (item: any, group?: KnowledgeResourceGroup) => React.ReactNode;
  renderItemEmployeeResource: (tabKey: string, item: any, group?: KnowledgeResourceGroup) => React.ReactNode;
  onKnowledgeBaseGoBack: () => void;
  onKnowledgeFileClick?: () => void;
}

const EmployeeResourceContent = ({
  tabKey,
  list,
  knowledgeResourceGroups,
  employeeResourceGroups,
  expandAllGroupsByDefault,
  currentKnowledgeBase,
  activeSiderAgentResourceId,
  renderList,
  renderItemKnowledgeBase,
  renderItemEmployeeResource,
  onKnowledgeBaseGoBack,
  onKnowledgeFileClick,
}: Props) => {
  if (tabKey === 'knowledge') {
    if (currentKnowledgeBase) {
      return (
        <KnowledgeBaseDetail
          editable={false}
          dataset={currentKnowledgeBase}
          onGoBack={onKnowledgeBaseGoBack}
          onFileClick={onKnowledgeFileClick}
          activeAgentResourceId={activeSiderAgentResourceId}
          quoteDisabled={Boolean(currentKnowledgeBase.quoteDisabled)}
        />
      );
    }

    return (
      <KnowledgeResourceGroupedContent
        groups={knowledgeResourceGroups}
        expandAllByDefault={expandAllGroupsByDefault}
        renderList={renderList}
        renderItem={renderItemKnowledgeBase}
      />
    );
  }

  if (employeeResourceGroups.length) {
    return (
      <KnowledgeResourceGroupedContent
        groups={employeeResourceGroups}
        listClassName={styles.employeeResourceSiderList}
        expandAllByDefault={expandAllGroupsByDefault}
        renderList={renderList}
        renderItem={(item, group) => renderItemEmployeeResource(tabKey, item, group)}
      />
    );
  }

  return renderList(list, (item: any) => renderItemEmployeeResource(tabKey, item), styles.employeeResourceSiderList);
};

export default EmployeeResourceContent;
