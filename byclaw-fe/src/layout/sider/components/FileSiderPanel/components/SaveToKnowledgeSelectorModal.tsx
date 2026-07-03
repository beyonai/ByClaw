import React from 'react';
import KnowledgeTargetSelector, { type KnowledgeTargetItem } from '@/components/KnowledgeTargetSelector';
import type { IKnowledgeBaseItem } from '../../Knowledge/components/KnowledgeBase/types';
import type { QueryDirAndFileByLevelItem } from '@/service/knowledgeCenter';

interface SaveToKnowledgeSelectorModalProps {
  open: boolean;
  confirmLoading: boolean;
  keyword: string;
  knowledgeBases: IKnowledgeBaseItem[];
  knowledgeLoading: boolean;
  selectedKnowledgeBase: IKnowledgeBaseItem | null;
  directoryPath: string;
  folders: QueryDirAndFileByLevelItem[];
  folderLoading: boolean;
  emptyText: React.ReactNode;
  folderEmptyText: React.ReactNode;
  onOk: () => void;
  onCancel: () => void;
  onKeywordChange: (keyword: string) => void;
  onSearch: (keyword: string) => void;
  onSelectKnowledgeBase: (kb: IKnowledgeBaseItem) => void;
  onFolderClick: (folder: QueryDirAndFileByLevelItem, directoryPath: string) => void;
  onLoadFolderChildren: (directoryPath: string) => Promise<QueryDirAndFileByLevelItem[] | void>;
}

const SaveToKnowledgeSelectorModal: React.FC<SaveToKnowledgeSelectorModalProps> = ({
  open,
  confirmLoading,
  keyword,
  knowledgeBases,
  knowledgeLoading,
  selectedKnowledgeBase,
  directoryPath,
  folders,
  folderLoading,
  emptyText,
  folderEmptyText,
  onOk,
  onCancel,
  onKeywordChange,
  onSearch,
  onSelectKnowledgeBase,
  onFolderClick,
  onLoadFolderChildren,
}) => {
  return (
    <KnowledgeTargetSelector
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      confirmLoading={confirmLoading}
      okDisabled={!selectedKnowledgeBase}
      keyword={keyword}
      onKeywordChange={onKeywordChange}
      onSearch={onSearch}
      knowledgeBases={knowledgeBases}
      knowledgeLoading={knowledgeLoading}
      selectedKnowledgeBase={selectedKnowledgeBase}
      onSelectKnowledgeBase={(kb: KnowledgeTargetItem) => onSelectKnowledgeBase(kb as IKnowledgeBaseItem)}
      directoryPath={directoryPath}
      folders={folders}
      folderLoading={folderLoading}
      onFolderClick={onFolderClick}
      onLoadFolderChildren={onLoadFolderChildren}
      emptyText={emptyText}
      folderEmptyText={folderEmptyText}
    />
  );
};

export default SaveToKnowledgeSelectorModal;
