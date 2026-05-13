// @ts-nocheck
import React, { useState, useCallback } from 'react';
import { Modal, Upload, Button, message } from 'antd';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import { useIntl } from '@umijs/max';
import type { UploadFile, UploadProps, UploadChangeParam, RcFile } from 'antd/es/upload';
import styles from './UploadTestSetModal.module.less';

const { Dragger } = Upload;

// 文件上传配置常量
const FILE_UPLOAD_CONFIG = {
  MAX_SIZE_MB: 50,
  ACCEPTED_TYPES: ['.xls', '.xlsx'],
  MIME_TYPES: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
} as const;

interface UploadTestSetModalProps {
  visible: boolean;
  onCancel: () => void;
  onOk?: (file: File) => void;
  agentId?: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const UploadTestSetModal: React.FC<UploadTestSetModalProps> = ({ visible, onCancel, onOk, _agentId }) => {
  const intl = useIntl();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);

  // 验证文件类型
  const validateFileType = useCallback(
    (file: RcFile): boolean => {
      const isValidMimeType = FILE_UPLOAD_CONFIG.MIME_TYPES.includes(file.type as any);
      const isValidExtension = FILE_UPLOAD_CONFIG.ACCEPTED_TYPES.some((ext) => file.name.toLowerCase().endsWith(ext));

      if (!isValidMimeType && !isValidExtension) {
        message.error(intl.formatMessage({ id: 'operation.uploadTestSet.fileTypeError' }));
        return false;
      }

      return true;
    },
    [intl]
  );

  // 验证文件大小
  const validateFileSize = useCallback(
    (file: RcFile): boolean => {
      const fileSizeMB = file.size / 1024 / 1024;
      if (fileSizeMB >= FILE_UPLOAD_CONFIG.MAX_SIZE_MB) {
        message.error(intl.formatMessage({ id: 'operation.uploadTestSet.fileSizeError' }));
        return false;
      }
      return true;
    },
    [intl]
  );

  // 处理文件上传前的验证
  const beforeUpload: UploadProps['beforeUpload'] = useCallback(
    (file: RcFile) => {
      // 检查文件类型
      if (!validateFileType(file)) {
        return false;
      }

      // 检查文件大小
      if (!validateFileSize(file)) {
        return false;
      }

      // 更新文件列表
      setFileList([
        {
          uid: file.uid,
          name: file.name,
          status: 'done',
          originFileObj: file,
        },
      ]);

      return false; // 阻止自动上传
    },
    [validateFileType, validateFileSize]
  );

  // 处理文件移除
  const handleRemove = useCallback(() => {
    setFileList([]);
  }, []);

  // 处理文件变化
  const handleChange: UploadProps['onChange'] = useCallback((info: UploadChangeParam<UploadFile>) => {
    if (info.file.status === 'removed') {
      setFileList([]);
    }
  }, []);

  // 处理运行按钮点击
  const handleRun = useCallback(async () => {
    if (fileList.length === 0) {
      message.warning(intl.formatMessage({ id: 'operation.uploadTestSet.noFileSelected' }));
      return;
    }

    const file = fileList[0].originFileObj as File;
    if (!file) {
      message.error(intl.formatMessage({ id: 'operation.uploadTestSet.fileNotFound' }));
      return;
    }

    try {
      setUploading(true);
      if (onOk) {
        await onOk(file);
      }
      setFileList([]);
    } catch (error) {
      console.error('上传测试集失败:', error);
      message.error(intl.formatMessage({ id: 'operation.uploadTestSet.uploadFail' }));
    } finally {
      setUploading(false);
    }
  }, [fileList, onOk, intl]);

  // 处理取消
  const handleCancel = useCallback(() => {
    setFileList([]);
    onCancel();
  }, [onCancel]);

  return (
    <Modal
      title={intl.formatMessage({ id: 'operation.uploadTestSet.title' })}
      open={visible}
      onCancel={handleCancel}
      footer={[
        <Button key="cancel" onClick={handleCancel}>
          {intl.formatMessage({ id: 'operation.uploadTestSet.cancel' })}
        </Button>,
        <Button key="run" type="primary" loading={uploading} onClick={handleRun} disabled={fileList.length === 0}>
          {intl.formatMessage({ id: 'operation.uploadTestSet.run' })}
        </Button>,
      ]}
      width={520}
      className={styles.uploadModal}
      destroyOnHidden
    >
      <div className={styles.uploadContent}>
        <Dragger
          name="file"
          multiple={false}
          fileList={fileList}
          beforeUpload={beforeUpload}
          onChange={handleChange}
          onRemove={handleRemove}
          accept={FILE_UPLOAD_CONFIG.ACCEPTED_TYPES.join(',')}
          className={styles.uploadDragger}
        >
          <div className={styles.uploadIcon}>
            <AntdIcon type="icon-a-shouye-File-addition-onewenjiantianjia1" style={{ fontSize: 32 }} />
          </div>
          <p className={styles.uploadText}>
            {intl.formatMessage({ id: 'operation.uploadTestSet.dragText' })}
            <span className={styles.selectFileLink}>
              {intl.formatMessage({ id: 'operation.uploadTestSet.selectFile' })}
            </span>
          </p>
          <p className={styles.uploadHint}>{intl.formatMessage({ id: 'operation.uploadTestSet.hint' })}</p>
        </Dragger>
      </div>
    </Modal>
  );
};

export default UploadTestSetModal;
