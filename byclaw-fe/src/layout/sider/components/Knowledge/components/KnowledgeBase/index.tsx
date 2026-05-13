import React, { useState } from 'react';
import { IKnowledgeBaseItem, IKnowledgeCollectionItem } from './types';
import KnowledgeBaseList from './KnowledgeBaseList';
import KnowledgeBaseDetail from './KnowledgeBaseDetail';
import { IDragType } from '@/components/QueryInput/withDrag';

interface Props {
  editable?: boolean;
  onSelect?: (item: IKnowledgeBaseItem | IKnowledgeCollectionItem, dragType: IDragType) => void;
  keyword?: string;
  agentId?: string;
  agentIds?: string;
}

const KnowledgeBaseTab = ({ editable, onSelect, keyword, agentId, agentIds }: Props) => {
  const [currentKnowledgeBase, setCurrentKnowledgeBase] = useState<IKnowledgeBaseItem | null>(null);

  // 进入知识库详情
  const handleKnowledgeBaseDetail = (kb: IKnowledgeBaseItem) => {
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
        />
      </div>

      {currentKnowledgeBase && (
        <div style={{ height: '100%' }}>
          <KnowledgeBaseDetail editable={editable} dataset={currentKnowledgeBase} onGoBack={handleGoBack} />
        </div>
      )}
    </>
  );
};

export default KnowledgeBaseTab;
