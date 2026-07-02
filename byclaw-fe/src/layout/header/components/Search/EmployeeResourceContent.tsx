import React from 'react';
import { Spin } from 'antd';
import AntdIcon from '@/components/AntdIcon';
import KnowledgeBaseDetail from '@/layout/sider/components/Knowledge/components/KnowledgeBase/KnowledgeBaseDetail';
import type { IKnowledgeBaseItem } from '@/layout/sider/components/Knowledge/components/KnowledgeBase/types';
import type { EmployeeResourceDrillState } from './types';
import styles from './index.module.less';

interface Props {
  tabKey: string;
  list: any[];
  currentKnowledgeBase: IKnowledgeBaseItem | null;
  activeSiderAgentResourceId?: string;
  employeeResourceDrillState: EmployeeResourceDrillState | null;
  employeeResourceDrillLoading: boolean;
  intl: {
    formatMessage: (descriptor: { id: string }) => string;
  };
  renderList: (list: any[], renderItem: (item: any) => React.ReactNode, className?: string) => React.ReactNode;
  renderItemKnowledgeBase: (item: any) => React.ReactNode;
  renderItemEmployeeResource: (tabKey: string, item: any) => React.ReactNode;
  onKnowledgeBaseGoBack: () => void;
  onEmployeeResourceGoBack: () => void;
}

const EmployeeResourceContent = ({
  tabKey,
  list,
  currentKnowledgeBase,
  activeSiderAgentResourceId,
  employeeResourceDrillState,
  employeeResourceDrillLoading,
  intl,
  renderList,
  renderItemKnowledgeBase,
  renderItemEmployeeResource,
  onKnowledgeBaseGoBack,
  onEmployeeResourceGoBack,
}: Props) => {
  if (tabKey === 'knowledge') {
    if (currentKnowledgeBase) {
      return (
        <KnowledgeBaseDetail
          editable={false}
          dataset={currentKnowledgeBase}
          onGoBack={onKnowledgeBaseGoBack}
          activeAgentResourceId={activeSiderAgentResourceId}
        />
      );
    }

    return renderList(list, renderItemKnowledgeBase, styles.knowledgeResourceList);
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

  return renderList(list, (item: any) => renderItemEmployeeResource(tabKey, item), styles.employeeResourceSiderList);
};

export default EmployeeResourceContent;
