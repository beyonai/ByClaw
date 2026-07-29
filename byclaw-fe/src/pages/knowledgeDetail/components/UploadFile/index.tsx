import { useEffect, useState } from 'react';
import { Button, message, Tooltip } from 'antd';

// @ts-ignore
import { useIntl } from '@umijs/max';

import AntdIcon from '@/components/AntdIcon';
import UploadConfirmModal from '@/components/UploadConfirmModal';
import { checkUploadFileConflicts, uploadFiles } from '@/service/knowledgeCenter';
import { useFileTookit } from '@/hooks/useFileTookit';

interface IProps {
  baseInfo: any;
  uploadLoading: boolean;
  setUploadLoading: (loading: boolean) => void;
  reload?: () => void;

  /** 上传到知识库时的目标目录路径，根目录为 "/" */
  directoryPath: string;
}

const UploadFile = (props: IProps) => {
  const { baseInfo, uploadLoading, setUploadLoading, reload, directoryPath } = props;

  const { pick, message: uploadMessage } = useFileTookit();

  const intl = useIntl();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadConflicts, setUploadConflicts] = useState<string[]>([]);
  const [conflictChecking, setConflictChecking] = useState(false);
  const uploadDirectory = directoryPath || '/';
  const hasUploadConflicts = uploadConflicts.length > 0;

  const handlePick = async () => {
    const files = await pick({
      count: 10, // 最多选择10个文件
      multiple: true,
      totalSize: 1024 * 1024 * 200, // 总共不能超过200MB
    });
    if (!files) return;

    try {
      setConflictChecking(true);
      const conflictResult = await checkUploadFileConflicts({
        resourceId: baseInfo?.resourceId,
        directoryPath: uploadDirectory,
        fileNames: files.map((file) => file.name),
      });
      setPendingFiles(files);
      setUploadConflicts(conflictResult?.overwritePaths || []);
      setConfirmOpen(true);
    } catch (err) {
      message.error(err as string);
    } finally {
      setConflictChecking(false);
    }
  };

  const handleUpload = async (processFrontMatter: boolean) => {
    if (!pendingFiles.length) return;

    const formData = new FormData();
    pendingFiles.forEach((file) => {
      formData.append('files', file);
    });
    formData.append('resourceId', baseInfo?.resourceId);
    formData.append('directoryPath', uploadDirectory);
    // 开关打开时解析 YAML Front Matter，关闭时不解析。
    formData.append('processFrontMatter', String(processFrontMatter));
    // QA import 暂不支持原子覆盖，后端收到 true 后会先删同路径同名旧文件再导入新文件。
    formData.append('overwrite', String(hasUploadConflicts));

    try {
      setUploadLoading(true);
      const result = await uploadFiles(formData);
      const succeeded = Number(result?.summary?.succeeded || 0);
      const failed = Number(result?.summary?.failed || 0);
      const postProcessErrorCount = result?.postProcessErrors?.length || 0;
      if (failed > 0) {
        const content = intl.formatMessage({ id: 'knowledgeDetail.uploadPartial' }, { succeeded, failed });
        if (succeeded === 0) {
          message.error(content);
        } else {
          message.warning(content);
        }
      } else if (postProcessErrorCount > 0) {
        message.warning(
          intl.formatMessage({ id: 'knowledgeDetail.uploadPostProcessWarning' }, { count: postProcessErrorCount })
        );
      } else {
        message.success(intl.formatMessage({ id: 'knowledgeDetail.uploadSuccess' }));
      }
      if (succeeded === 0 && failed > 0) return;
      setConfirmOpen(false);
      setPendingFiles([]);
      setUploadConflicts([]);
      reload?.();
    } catch (err) {
      message.error(err as string);
    } finally {
      setUploadLoading(false);
    }
  };

  const handleCancel = () => {
    if (uploadLoading) return;
    setConfirmOpen(false);
    setPendingFiles([]);
    setUploadConflicts([]);
  };

  useEffect(() => {
    if (uploadMessage) message.warning(uploadMessage);
  }, [uploadMessage]);

  return (
    <>
      <Tooltip title={intl.formatMessage({ id: 'knowledgeDetail.sameNameFileOverwriteTip' })}>
        <Button
          loading={uploadLoading || conflictChecking}
          type="primary"
          onClick={handlePick}
          icon={<AntdIcon type="icon-a-Uploadshangchuan" style={{ fontSize: 18 }} />}
        >
          {intl.formatMessage({
            id: 'knowledgeDetail.uploadFile',
          })}
        </Button>
      </Tooltip>
      <UploadConfirmModal
        open={confirmOpen}
        files={pendingFiles}
        directoryPath={uploadDirectory}
        conflicts={uploadConflicts}
        loading={uploadLoading}
        showProcessFrontMatter
        okText={intl.formatMessage({
          id: hasUploadConflicts ? 'knowledgeDetail.confirmOverwriteUpload' : 'knowledgeDetail.uploadFile',
        })}
        onOk={handleUpload}
        onCancel={handleCancel}
      />
    </>
  );
};

export default UploadFile;
