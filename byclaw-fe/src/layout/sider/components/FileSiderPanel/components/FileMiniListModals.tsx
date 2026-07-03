import React from 'react';
import { message } from 'antd';
import { useIntl } from '@umijs/max';
import CopyToFileBrowserModal, { type FileBrowserFolderPathItem } from '@/components/CopyToFileBrowserModal';
import UploadConfirmModal, { type UploadConfirmFile } from '@/components/UploadConfirmModal';
import RenameModal from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/RenameModal';
import type { IKnowledgeBaseItem } from '@/layout/sider/components/Knowledge/components/KnowledgeBase/types';
import type { FileBrowserItem } from '@/service/fileBrowser';
import type { QueryDirAndFileByLevelItem } from '@/service/knowledgeCenter';
import CreateFolderModal from './CreateFolderModal';
import SaveToKnowledgeSelectorModal from './SaveToKnowledgeSelectorModal';
import UploadDirectoryPickerModal from './UploadDirectoryPickerModal';
import { buildTargetFolderPath } from '../utils';
import type { FileCopyTargetType } from '../constants';

interface FileMiniListModalsProps {
  uploadConfirmOpen: boolean;
  knowledgeUploadConfirmOpen: boolean;
  uploadConfirmFiles: UploadConfirmFile[];
  uploadConfirmDirectoryPath: string;
  uploadConfirmConflicts: string[];
  uploadConfirmLoading: boolean;
  showProcessFrontMatter: boolean;
  uploadConfirmOkText: string;
  onUploadDirectoryAction?: () => void;
  onUploadConfirmOk: (processFrontMatter: boolean) => void;
  onUploadConfirmCancel: () => void;

  createFolderOpen: boolean;
  createFolderName: string;
  createFolderError?: string;
  creatingFolder: boolean;
  onCreateFolderNameChange: (name: string) => void;
  onCreateFolderOk: () => void;
  onCreateFolderCancel: () => void;

  renameOpen: boolean;
  renameTargetName: string;
  renameLoading: boolean;
  onRenameOk: (name: string) => void;
  onRenameCancel: () => void;

  uploadDirectoryPickerOpen: boolean;
  uploadDirectoryPath: string;
  uploadDirectoryBasePath: string;
  uploadDirectoryBreadcrumb: FileBrowserFolderPathItem[];
  uploadDirectoryFolders: FileBrowserItem[];
  uploadDirectoryLoading: boolean;
  canConfirmUploadDirectory: boolean;
  onUploadDirectoryOk: () => void;
  onUploadDirectoryCancel: () => void;
  onLoadUploadDirectoryFolders: (path: string) => void;

  copyModalOpen: boolean;
  copyTargetType: FileCopyTargetType;
  copyTargetName?: React.ReactNode;
  copyDirectoryPath: string;
  copyFolderPath: FileBrowserFolderPathItem[];
  copyFolders: FileBrowserItem[];
  copyFolderLoading: boolean;
  copyingToFileBrowser: boolean;
  onCopyOk: () => void;
  onCopyCancel: () => void;
  onLoadCopyFolders: (path: string) => void;

  saveModalOpen: boolean;
  savingToKnowledge: boolean;
  knowledgeKeyword: string;
  onKnowledgeKeywordChange: (keyword: string) => void;
  onKnowledgeSearch: (keyword: string) => void;
  knowledgeBases: IKnowledgeBaseItem[];
  knowledgeLoading: boolean;
  selectedKnowledgeBase: IKnowledgeBaseItem | null;
  onSelectKnowledgeBase: (kb: IKnowledgeBaseItem) => void;
  knowledgeDirectoryPath: string;
  knowledgeFolders: QueryDirAndFileByLevelItem[];
  knowledgeFolderLoading: boolean;
  onKnowledgeFolderClick: (directoryPath: string) => void;
  onLoadKnowledgeFolderChildren: (directoryPath: string) => Promise<QueryDirAndFileByLevelItem[] | void>;
  onSaveToKnowledgeOk: () => void;
  onSaveToKnowledgeCancel: () => void;
}

const FileMiniListModals: React.FC<FileMiniListModalsProps> = ({
  uploadConfirmOpen,
  knowledgeUploadConfirmOpen,
  uploadConfirmFiles,
  uploadConfirmDirectoryPath,
  uploadConfirmConflicts,
  uploadConfirmLoading,
  showProcessFrontMatter,
  uploadConfirmOkText,
  onUploadDirectoryAction,
  onUploadConfirmOk,
  onUploadConfirmCancel,
  createFolderOpen,
  createFolderName,
  createFolderError,
  creatingFolder,
  onCreateFolderNameChange,
  onCreateFolderOk,
  onCreateFolderCancel,
  renameOpen,
  renameTargetName,
  renameLoading,
  onRenameOk,
  onRenameCancel,
  uploadDirectoryPickerOpen,
  uploadDirectoryPath,
  uploadDirectoryBasePath,
  uploadDirectoryBreadcrumb,
  uploadDirectoryFolders,
  uploadDirectoryLoading,
  canConfirmUploadDirectory,
  onUploadDirectoryOk,
  onUploadDirectoryCancel,
  onLoadUploadDirectoryFolders,
  copyModalOpen,
  copyTargetType,
  copyTargetName,
  copyDirectoryPath,
  copyFolderPath,
  copyFolders,
  copyFolderLoading,
  copyingToFileBrowser,
  onCopyOk,
  onCopyCancel,
  onLoadCopyFolders,
  saveModalOpen,
  savingToKnowledge,
  knowledgeKeyword,
  onKnowledgeKeywordChange,
  onKnowledgeSearch,
  knowledgeBases,
  knowledgeLoading,
  selectedKnowledgeBase,
  onSelectKnowledgeBase,
  knowledgeDirectoryPath,
  knowledgeFolders,
  knowledgeFolderLoading,
  onKnowledgeFolderClick,
  onLoadKnowledgeFolderChildren,
  onSaveToKnowledgeOk,
  onSaveToKnowledgeCancel,
}) => {
  const intl = useIntl();

  return (
    <>
      <UploadConfirmModal
        open={uploadConfirmOpen || knowledgeUploadConfirmOpen}
        files={uploadConfirmFiles}
        directoryPath={uploadConfirmDirectoryPath}
        conflicts={uploadConfirmConflicts}
        loading={uploadConfirmLoading}
        showProcessFrontMatter={showProcessFrontMatter}
        okText={uploadConfirmOkText}
        directoryActionText={intl.formatMessage({ id: 'fileBrowser.upload.changeDirectory' })}
        onDirectoryAction={onUploadDirectoryAction}
        onOk={onUploadConfirmOk}
        onCancel={onUploadConfirmCancel}
      />
      <CreateFolderModal
        open={createFolderOpen}
        value={createFolderName}
        error={createFolderError}
        loading={creatingFolder}
        onChange={onCreateFolderNameChange}
        onOk={onCreateFolderOk}
        onCancel={onCreateFolderCancel}
      />
      <RenameModal
        open={renameOpen}
        currentName={renameTargetName}
        onOk={onRenameOk}
        onCancel={onRenameCancel}
        loading={renameLoading}
      />
      <UploadDirectoryPickerModal
        open={uploadDirectoryPickerOpen}
        directoryPath={uploadDirectoryPath}
        basePath={uploadDirectoryBasePath}
        breadcrumb={uploadDirectoryBreadcrumb}
        folders={uploadDirectoryFolders}
        loading={uploadDirectoryLoading}
        canConfirm={canConfirmUploadDirectory}
        onOk={onUploadDirectoryOk}
        onCancel={onUploadDirectoryCancel}
        onLoadFolders={onLoadUploadDirectoryFolders}
        onInvalidDirectory={() => {
          message.warning(intl.formatMessage({ id: 'fileBrowser.upload.directoryScopeTip' }));
        }}
      />
      <CopyToFileBrowserModal
        open={copyModalOpen}
        targetType={copyTargetType}
        sourceName={copyTargetName}
        targetDirectory={copyDirectoryPath}
        folderPath={copyFolderPath}
        folders={copyFolders}
        loading={copyFolderLoading}
        confirmLoading={copyingToFileBrowser}
        onOk={onCopyOk}
        onCancel={onCopyCancel}
        onBreadcrumbClick={(target) => {
          onLoadCopyFolders(target.id);
        }}
        onFolderClick={(folder) => {
          onLoadCopyFolders(buildTargetFolderPath(copyDirectoryPath, folder.name));
        }}
      />
      <SaveToKnowledgeSelectorModal
        open={saveModalOpen}
        onOk={onSaveToKnowledgeOk}
        onCancel={onSaveToKnowledgeCancel}
        confirmLoading={savingToKnowledge}
        keyword={knowledgeKeyword}
        onKeywordChange={onKnowledgeKeywordChange}
        onSearch={onKnowledgeSearch}
        knowledgeBases={knowledgeBases}
        knowledgeLoading={knowledgeLoading}
        selectedKnowledgeBase={selectedKnowledgeBase}
        onSelectKnowledgeBase={onSelectKnowledgeBase}
        directoryPath={knowledgeDirectoryPath}
        folders={knowledgeFolders}
        folderLoading={knowledgeFolderLoading}
        onFolderClick={(_, directoryPath) => {
          onKnowledgeFolderClick(directoryPath);
        }}
        onLoadFolderChildren={onLoadKnowledgeFolderChildren}
        emptyText={intl.formatMessage({ id: 'multiChoices.saveToKnowledge.empty' })}
        folderEmptyText={intl.formatMessage({ id: 'fileSider.saveToKnowledge.rootTip' })}
      />
    </>
  );
};

export default FileMiniListModals;
