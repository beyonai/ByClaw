import React from 'react';
import { Spin } from 'antd';
import AntdIcon from '@/components/AntdIcon';
import KnowledgeBaseDetail from '@/layout/sider/components/Knowledge/components/KnowledgeBase/KnowledgeBaseDetail';
import type { IKnowledgeBaseItem } from '@/layout/sider/components/Knowledge/components/KnowledgeBase/types';
import KnowledgeResourceGroupedContent from './KnowledgeResourceGroupedContent';
import type { EmployeeResourceDrillState, KnowledgeResourceGroup } from './types';
import styles from './index.module.less';

interface Props {
  tabKey: string;
  list: any[];
  knowledgeResourceGroups: KnowledgeResourceGroup[];
  employeeResourceGroups: KnowledgeResourceGroup[];
  expandAllGroupsByDefault?: boolean;
  currentKnowledgeBase: IKnowledgeBaseItem | null;
  activeSiderAgentResourceId?: string;
  employeeResourceDrillState: EmployeeResourceDrillState | null;
  employeeResourceDrillLoading: boolean;
  intl: {
    formatMessage: (descriptor: { id: string }) => string;
  };
  renderList: (list: any[], renderItem: (item: any) => React.ReactNode, className?: string) => React.ReactNode;
  renderItemKnowledgeBase: (item: any, group?: KnowledgeResourceGroup) => React.ReactNode;
  renderItemEmployeeResource: (tabKey: string, item: any, group?: KnowledgeResourceGroup) => React.ReactNode;
  onKnowledgeBaseGoBack: () => void;
  onKnowledgeFileClick?: () => void;
  onEmployeeResourceGoBack: () => void;
}

const EmployeeResourceContent = ({
  tabKey,
  list,
  knowledgeResourceGroups,
  employeeResourceGroups,
  expandAllGroupsByDefault,
  currentKnowledgeBase,
  activeSiderAgentResourceId,
  employeeResourceDrillState,
  employeeResourceDrillLoading,
  intl,
  renderList,
  renderItemKnowledgeBase,
  renderItemEmployeeResource,
  onKnowledgeBaseGoBack,
  onKnowledgeFileClick,
  onEmployeeResourceGoBack,
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

  if (employeeResourceDrillState?.tabKey === tabKey) {
    return (
      <div className={styles.employeeResourceDrillContent}>
        <div className={styles.employeeResourceDrillBack} onClick={onEmployeeResourceGoBack}>
          <AntdIcon type="icon-a-Leftzuo" />
          <span>
            {employeeResourceDrillState.breadcrumb[employeeResourceDrillState.breadcrumb.length - 1]?.item
              .resourceName || intl.formatMessage({ id: 'dialogueRecord.all' })}
          </span>
        </div>
        {employeeResourceDrillLoading ? (
          <div className={styles.employeeResourceDrillLoading}>
            <Spin spinning tip={intl.formatMessage({ id: 'common.querying' })}>
              <div className={styles.loadingContent} />
            </Spin>
          </div>
        ) : (
          renderList(
            employeeResourceDrillState.list,
            (item: any) => renderItemEmployeeResource(tabKey, item),
            styles.employeeResourceSiderList
          )
        )}
      </div>
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
