import React, { useCallback, useEffect, useState } from 'react';
import { Form, Input, Modal, message } from 'antd';
import { CloseOutlined, FolderAddOutlined, FolderOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import type { DevloopProjectLocalDirectoryPayload } from '@/service/devloop';
import { mergeLocalDirectories, removeLocalDirectory, setPrimaryLocalDirectory } from './utils';
import styles from './index.module.less';

export interface DesktopProjectCreateValues {
  projectName: string;
  localDirectories: DevloopProjectLocalDirectoryPayload[];
}

interface Props {
  open: boolean;
  loading?: boolean;
  onCancel: () => void;
  onSubmit: (values: DesktopProjectCreateValues) => Promise<string>;
}

interface DesktopProjectNameForm {
  projectName: string;
}

const DesktopProjectCreateModal: React.FC<Props> = ({ open, loading, onCancel, onSubmit }) => {
  const intl = useIntl();
  const [form] = Form.useForm<DesktopProjectNameForm>();
  const [directories, setDirectories] = useState<DevloopProjectLocalDirectoryPayload[]>([]);
  const [selecting, setSelecting] = useState(false);
  const t = useCallback((id: string) => intl.formatMessage({ id: `projectSpace.desktop.${id}` }), [intl]);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    setDirectories([]);
    setSelecting(false);
  }, [form, open]);

  const selectDirectories = async () => {
    if (selecting) return;
    const picker = window.byclawDesktop?.dialog?.selectDirectories;
    if (!picker) {
      message.error(t('folderPickerUnavailable'));
      return;
    }

    setSelecting(true);
    try {
      const result = await picker();
      if (!result.canceled) {
        setDirectories((current) => mergeLocalDirectories(current, result.paths, window.byclawDesktop?.platform));
      }
    } catch (error) {
      console.error('Failed to select local project folders:', error);
      message.error(t('folderPickerFailed'));
    } finally {
      setSelecting(false);
    }
  };

  const handleSubmit = async () => {
    if (loading) return;
    let values: DesktopProjectNameForm;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    if (!directories.length) {
      message.warning(t('folderRequired'));
      return;
    }
    await onSubmit({ projectName: values.projectName.trim(), localDirectories: directories });
  };

  const renderDirectoryPicker = () => {
    if (!directories.length) {
      return (
        <button type="button" className={styles.emptyPicker} onClick={() => void selectDirectories()}>
          <FolderAddOutlined />
          <span>{t('addReadableFolder')}</span>
        </button>
      );
    }

    return (
      <div className={styles.directoryList}>
        {directories.map((directory) => (
          <div className={styles.directoryRow} key={directory.path} title={directory.path}>
            <FolderOutlined className={styles.directoryIcon} />
            <span className={styles.directoryName}>{directory.name}</span>
            {directories.length > 1 &&
              (directory.primary ? (
                <span className={styles.primaryBadge}>{t('primary')}</span>
              ) : (
                <button
                  type="button"
                  className={styles.setPrimaryButton}
                  onClick={() => setDirectories((current) => setPrimaryLocalDirectory(current, directory.path))}
                >
                  {t('setPrimary')}
                </button>
              ))}
            <button
              type="button"
              className={styles.removeButton}
              aria-label={`${t('removeFolder')}: ${directory.name}`}
              onClick={() => setDirectories((current) => removeLocalDirectory(current, directory.path))}
            >
              <CloseOutlined />
            </button>
          </div>
        ))}
        <button type="button" className={styles.addFolderButton} onClick={() => void selectDirectories()}>
          <FolderAddOutlined />
          <span>{t('addFolder')}</span>
        </button>
      </div>
    );
  };

  return (
    <Modal
      className={styles.desktopCreateModal}
      destroyOnClose
      centered
      open={open}
      title={t('createTitle')}
      width={640}
      confirmLoading={loading}
      okText={t('create')}
      cancelText={intl.formatMessage({ id: 'common.cancel' })}
      okButtonProps={{ disabled: selecting }}
      onCancel={onCancel}
      onOk={() => void handleSubmit()}
    >
      <Form form={form} layout="vertical" initialValues={{ projectName: '' }}>
        <Form.Item
          name="projectName"
          rules={[{ required: true, whitespace: true, message: t('projectNameRequired') }, { max: 100 }]}
        >
          <Input
            className={styles.projectNameInput}
            maxLength={100}
            prefix={<FolderOutlined />}
            placeholder={t('projectNamePlaceholder')}
            onPressEnter={() => void handleSubmit()}
          />
        </Form.Item>
        <div className={styles.sourceFolderLabel}>{t('sourceFolders')}</div>
        {renderDirectoryPicker()}
      </Form>
    </Modal>
  );
};

export default DesktopProjectCreateModal;
