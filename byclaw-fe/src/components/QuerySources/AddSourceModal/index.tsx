/**
 * AddSourceModal 组件
 * 添加来源弹窗，包含Web搜索区域和文件上传选项
 */

import React, { useCallback, useState, useRef, useMemo } from 'react';
import { useIntl } from '@umijs/max';
import { Modal, Button, Upload, Input, message } from 'antd';
import { UploadOutlined, FileTextOutlined, ArrowLeftOutlined, InboxOutlined } from '@ant-design/icons';
import type { UploadFile, UploadProps } from 'antd/es/upload';
import styles from './index.less';
import useGlobal from '@/hooks/useGlobal';
import { validateAccept } from '@/utils/file';

type ModalView = 'main' | 'pasteUrl' | 'pasteText';

/** 添加来源弹窗组件Props */
interface AddSourceModalProps {

  /** 是否可见 */
  visible: boolean;

  /** 关闭回调 */
  onClose: () => void;

  /** 文件上传回调 */
  onFileUpload?: (file: File) => Promise<{ success: boolean; fileId?: string; fileUrl?: string }>;

  /** 粘贴网址回调 */
  onPasteUrl?: (url: string) => void;

  /** 粘贴文字回调 */
  onPasteText?: (text: string) => Promise<{ success: boolean; fileId?: string; fileUrl?: string }>;

  afterOpenChange?: (visible: boolean) => void;
}

const { Dragger } = Upload;
const { TextArea } = Input;

const AddSourceModal: React.FC<AddSourceModalProps> = (props) => {
  const { visible, onClose, onFileUpload, onPasteUrl, onPasteText } = props;

  const [currentView, setCurrentView] = useState<ModalView>('main');
  const [urlInput, setUrlInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileListRef = useRef<UploadFile[]>([]);

  const { uploadFileConfig } = useGlobal();
  const intl = useIntl();

  const handleClose = useCallback(() => {
    onClose();
    // 重置状态
    setTimeout(() => {
      setCurrentView('main');
      setUrlInput('');
      setTextInput('');
      setIsUploading(false);
      setIsSubmitting(false);
      fileListRef.current = [];
    }, 300);
  }, [onClose]);

  const handleBackToMain = useCallback(() => {
    setCurrentView('main');
    setUrlInput('');
    setTextInput('');
  }, []);

  // ==================== 文件上传处理 ====================

  const { maxFileSize, allowedFileTypes } = uploadFileConfig || {};

  const accept = useMemo(() => allowedFileTypes?.join(','), [allowedFileTypes]);

  const handleFileUpload = useCallback(
    async (file: File) => {
      if (!onFileUpload || !validateAccept(file, accept)) return false;

      if (maxFileSize) {
        const maxFileSizeNumber = Number(maxFileSize) * 1024 * 1024;
        if (file.size > maxFileSizeNumber) {
          message.error(intl.formatMessage({ id: 'upload.fileSizeLimit' }, { size: maxFileSize }));
          return false;
        }
      }

      setIsUploading(true);
      handleClose(); // 关闭弹窗

      try {
        const result = await onFileUpload(file);
        if (!result.success) {
          message.error('文件上传失败');
        }
      } catch (error) {
        console.error('Upload error:', error);
        message.error('文件上传失败');
      } finally {
        setIsUploading(false);
      }

      return false; // 阻止默认上传行为
    },
    [onFileUpload, handleClose, maxFileSize]
  );

  const uploadProps: UploadProps = {
    accept,
    name: 'file',
    multiple: false,
    showUploadList: false,
    beforeUpload: handleFileUpload,
    disabled: isUploading,
  };

  // ==================== 网址处理 ====================
  const handleUrlSubmit = useCallback(() => {
    if (!urlInput.trim()) {
      message.warning('请输入网址');
      return;
    }

    // 简单的URL验证
    const urlPattern = /^(https?:\/\/)?([\w.-]+)+(\/[\w.-]*)*\/?(\?[\w.&=-]*)?(#[\w-]*)?$/i;
    if (!urlPattern.test(urlInput.trim())) {
      message.warning('请输入有效的网址');
      return;
    }

    handleClose();
    onPasteUrl?.(urlInput.trim());
  }, [urlInput, onPasteUrl, handleClose]);

  // ==================== 文字处理 ====================
  const handleTextSubmit = useCallback(async () => {
    if (!textInput.trim()) {
      message.warning('请输入文字内容');
      return;
    }

    setIsSubmitting(true);
    handleClose();

    try {
      await onPasteText?.(textInput.trim());
    } catch (error) {
      console.error('Text submit error:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [textInput, onPasteText, handleClose]);

  // ==================== 渲染不同视图 ====================
  const renderMainView = () => (
    <div className={styles.modalContent}>
      {/* 拖拽上传区域 */}
      <Dragger {...uploadProps} className={styles.dragUpload}>
        <div className={styles.uploadSection}>
          <p className={styles.uploadDragIcon}>
            <InboxOutlined />
          </p>
          <div className={styles.uploadTitle}>点击或拖拽文件到此区域上传</div>
          <div className={styles.uploadSubtitle}>支持 PDF、图片、文档等多种格式</div>
        </div>
      </Dragger>

      {/* 其他选项 */}
      <div className={styles.uploadActions}>
        <Upload {...uploadProps}>
          <Button className={styles.uploadButton} icon={<UploadOutlined />} loading={isUploading}>
            上传文件
          </Button>
        </Upload>
        {/* <Button className={styles.uploadButton} icon={<LinkOutlined />} onClick={() => setCurrentView('pasteUrl')}>
          网站
        </Button> */}
        <Button className={styles.uploadButton} icon={<FileTextOutlined />} onClick={() => setCurrentView('pasteText')}>
          复制的文字
        </Button>
      </div>
    </div>
  );

  const renderPasteUrlView = () => (
    <div className={styles.pasteView}>
      <div className={styles.pasteHeader}>
        <Button type="text" icon={<ArrowLeftOutlined />} className={styles.backButton} onClick={handleBackToMain} />
        <span className={styles.pasteTitle}>粘贴网址</span>
      </div>
      <p className={styles.pasteDesc}>在下方粘贴网址，即可将其作为来源上传</p>
      <TextArea
        value={urlInput}
        onChange={(e) => setUrlInput(e.target.value)}
        placeholder="https://example.com"
        className={styles.pasteTextArea}
        rows={4}
      />
      <div className={styles.pasteFooter}>
        <Button type="primary" onClick={handleUrlSubmit} disabled={!urlInput.trim()}>
          确定
        </Button>
      </div>
    </div>
  );

  const renderPasteTextView = () => (
    <div className={styles.pasteView}>
      <div className={styles.pasteHeader}>
        <Button type="text" icon={<ArrowLeftOutlined />} className={styles.backButton} onClick={handleBackToMain} />
        <span className={styles.pasteTitle}>粘贴复制的文字</span>
      </div>
      <p className={styles.pasteDesc}>在下方粘贴复制的文字，即可将其作为来源上传</p>
      <TextArea
        value={textInput}
        onChange={(e) => setTextInput(e.target.value)}
        placeholder="在此粘贴文字内容..."
        className={styles.pasteTextArea}
        rows={6}
      />
      <div className={styles.pasteFooter}>
        <Button
          type="primary"
          onClick={handleTextSubmit}
          disabled={!textInput.trim() || isSubmitting}
          loading={isSubmitting}
        >
          确定
        </Button>
      </div>
    </div>
  );

  // 根据当前视图确定 Modal 标题
  const getModalTitle = () => {
    switch (currentView) {
      case 'pasteUrl':
        return null; // 在视图内部显示标题
      case 'pasteText':
        return null;
      default:
        return '添加来源';
    }
  };

  return (
    <Modal
      title={getModalTitle()}
      open={visible}
      onCancel={handleClose}
      footer={null}
      width={560}
      centered
      destroyOnHidden
      afterOpenChange={props.afterOpenChange}
      className={styles.addSourceModal}
    >
      {currentView === 'main' && renderMainView()}
      {currentView === 'pasteUrl' && renderPasteUrlView()}
      {currentView === 'pasteText' && renderPasteTextView()}
    </Modal>
  );
};

export default AddSourceModal;
