import React, { useContext, useState } from 'react';
import { IKnowledgeBaseItem, IKnowledgeCollectionItem } from './types';
import KnowledgeBaseList from './KnowledgeBaseList';
import KnowledgeBaseDetail from './KnowledgeBaseDetail';
import { IDragType } from '@/components/QueryInput/withDrag';
import { SiderContentContext } from '@/layout/sider/siderContentContext';

interface Props {
  editable?: boolean;
  onSelect?: (item: IKnowledgeBaseItem | IKnowledgeCollectionItem, dragType: IDragType) => void;
  keyword?: string;
  agentId?: string;
  agentIds?: string;
  activeAgentResourceId?: string;
  detailInPanel?: boolean;
}

const KnowledgeBaseTab = ({
  editable,
  onSelect,
  keyword,
  agentId,
  agentIds,
  activeAgentResourceId,
  detailInPanel = false,
}: Props) => {
  const [currentKnowledgeBase, setCurrentKnowledgeBase] = useState<IKnowledgeBaseItem | null>(null);
  const { setDetailPanel, clearDetailPanel } = useContext(SiderContentContext);

  // 进入知识库详情
  const handleKnowledgeBaseDetail = (kb: IKnowledgeBaseItem) => {
    if (detailInPanel) {
      setDetailPanel?.(
        <KnowledgeBaseDetail
          editable={editable}
          dataset={kb}
          onGoBack={() => clearDetailPanel?.()}
          activeAgentResourceId={activeAgentResourceId}
        />,
        {
          tabKey: `knowledge:${kb.resourceId}`,
          title: kb.resourceName,
        }
      );
      return;
    }
    setCurrentKnowledgeBase(kb);
  };

  // 返回列表
  const handleGoBack = () => {
    setCurrentKnowledgeBase(null);
    // 不需要重新加载列表，保持原有状态
  };

  return (
    <>
      <div style={{ height: '100%', display: currentKnowledgeBase ? 'none' : 'block' }}>
        <KnowledgeBaseList
          editable={editable}
          onSelect={onSelect}
          onDrilldown={handleKnowledgeBaseDetail}
          // 搜索关键词暂时只针对数据库这一层，进入下一层之后不处理
          keyword={keyword}
          agentId={agentId}
          agentIds={agentIds}
          activeAgentResourceId={activeAgentResourceId}
        />
      </div>

      {currentKnowledgeBase && (
        <div style={{ height: '100%' }}>
          <KnowledgeBaseDetail
            editable={editable}
            dataset={currentKnowledgeBase}
            onGoBack={handleGoBack}
            activeAgentResourceId={activeAgentResourceId}
          />
        </div>
      )}
    </>
  );
};

export default KnowledgeBaseTab;
