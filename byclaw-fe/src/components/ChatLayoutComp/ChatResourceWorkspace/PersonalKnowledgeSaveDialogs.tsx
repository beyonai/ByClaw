import { Alert, Button, Modal, Space, Typography } from 'antd';
import { useIntl } from '@umijs/max';
import KnowledgeTargetSelector from '@/components/KnowledgeTargetSelector';
import UploadConfirmModal from '@/components/UploadConfirmModal';
import useSaveToKnowledge from '@/layout/sider/components/FileSiderPanel/hooks/useSaveToKnowledge';
import type { IKnowledgeBaseItem } from '@/layout/sider/components/Knowledge/components/KnowledgeBase/types';
import { localizeErrorMessage } from '@/utils/localizeErrorMessage';

export default function PersonalKnowledgeSaveDialogs({ state }: { state: ReturnType<typeof useSaveToKnowledge> }) {
  const intl = useIntl();
  const text = (key: string) => intl.formatMessage({ id: `chatResource.personalKnowledge.${key}` });
  const result = state.saveResult;
  return (
    <>
      <KnowledgeTargetSelector
        title={text('save')}
        open={state.saveModalOpen}
        onOk={state.handleConfirmSaveToKnowledge}
        onCancel={state.handleCancelSaveToKnowledge}
        confirmLoading={state.savingToKnowledge}
        okDisabled={!state.selectedKnowledgeBase || state.knowledgeFolderLoading || state.savingToKnowledge}
        keyword={state.knowledgeKeyword}
        onKeywordChange={state.setKnowledgeKeyword}
        onSearch={state.loadKnowledgeBases}
        knowledgeBases={state.knowledgeBases}
        knowledgeLoading={state.knowledgeLoading}
        selectedKnowledgeBase={state.selectedKnowledgeBase}
        onSelectKnowledgeBase={(kb) => state.handleSelectKnowledgeBase(kb as IKnowledgeBaseItem)}
        directoryPath={state.knowledgeDirectoryPath}
        folders={state.knowledgeFolders}
        folderLoading={state.knowledgeFolderLoading}
        onFolderClick={(_, path) => {
          if (state.selectedKnowledgeBase) void state.loadKnowledgeFolders(state.selectedKnowledgeBase, path);
        }}
        onLoadFolderChildren={(path) =>
          state.selectedKnowledgeBase
            ? state.loadKnowledgeFolderChildren(state.selectedKnowledgeBase, path)
            : Promise.resolve([])
        }
        emptyText={text('empty')}
      />
      <UploadConfirmModal
        open={state.knowledgeUploadConfirmOpen}
        files={state.pendingKnowledgeUploads}
        directoryPath={state.pendingKnowledgeDirectoryPath}
        conflicts={state.pendingKnowledgeConflicts}
        loading={state.savingToKnowledge}
        showProcessFrontMatter
        okText={text(state.pendingKnowledgeConflicts.length ? 'overwrite' : 'confirm')}
        onOk={state.handleConfirmKnowledgeUpload}
        onCancel={state.handleCancelKnowledgeUpload}
      />
      <Modal
        title={text('result')}
        open={!!result}
        onCancel={() => {
          if (!state.retryingBuild) state.setSaveResult(null);
        }}
        footer={
          <Space>
            {!!result?.buildFailedItems?.length && (
              <Button loading={state.retryingBuild} onClick={state.retryFailedBuilds}>
                {text('retryBuild')}
              </Button>
            )}
            <Button disabled={state.retryingBuild} onClick={() => state.setSaveResult(null)}>
              {text('close')}
            </Button>
          </Space>
        }
      >
        {result && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Alert
              type={
                result.failedItems.length || result.buildFailedItems.length || result.postProcessErrors.length
                  ? 'warning'
                  : 'success'
              }
              message={intl.formatMessage(
                { id: 'chatResource.personalKnowledge.summary' },
                {
                  files: result.uploadedFileCount,
                  folders: result.createdFolderCount,
                  builds: result.buildSubmittedCount,
                }
              )}
              description={text('buildTip')}
            />
            {result.failedItems.map((item, index) => (
              <Typography.Paragraph key={`import-${index}`} type="danger">
                {text('importFailed')}：{item.filePath} —{' '}
                {localizeErrorMessage(item.error, intl.formatMessage({ id: 'fileBrowser.upload.failed' }), intl.locale)}
              </Typography.Paragraph>
            ))}
            {result.buildFailedItems.map((item, index) => (
              <Typography.Paragraph key={`build-${index}`} type="warning">
                {text('buildFailed')}：{item.filePath} —{' '}
                {localizeErrorMessage(item.error, text('buildFailed'), intl.locale)}
              </Typography.Paragraph>
            ))}
            {result.postProcessErrors.map((error, index) => (
              <Typography.Paragraph key={`post-${index}`} type="warning">
                {localizeErrorMessage(
                  error,
                  intl.formatMessage({ id: 'fileSider.saveToKnowledge.failed' }),
                  intl.locale
                )}
              </Typography.Paragraph>
            ))}
          </Space>
        )}
      </Modal>
    </>
  );
}
