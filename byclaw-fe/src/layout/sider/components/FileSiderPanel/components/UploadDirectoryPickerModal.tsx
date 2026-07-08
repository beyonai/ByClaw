import React from 'react';
import { List, Modal, Space, Spin, Typography } from 'antd';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import KnowledgeBreadcrumb from '@/components/KnowledgeBreadcrumb';
import type { FileBrowserItem } from '@/service/fileBrowser';
import type { FileBrowserFolderPathItem } from '@/components/CopyToFileBrowserModal';
import { buildTargetFolderPath, isAllowedUploadDirectoryTarget } from '../utils';
import styles from '../index.module.less';

interface UploadDirectoryPickerModalProps {
  open: boolean;
  directoryPath: string;
  basePath: string;
  breadcrumb: FileBrowserFolderPathItem[];
  folders: FileBrowserItem[];
  loading: boolean;
  canConfirm: boolean;
  onOk: () => void;
  onCancel: () => void;
  onLoadFolders: (path: string) => void;
  onInvalidDirectory: () => void;
}

const UploadDirectoryPickerModal: React.FC<UploadDirectoryPickerModalProps> = ({
  open,
  directoryPath,
  basePath,
  breadcrumb,
  folders,
  loading,
  canConfirm,
  onOk,
  onCancel,
  onLoadFolders,
  onInvalidDirectory,
}) => {
  const intl = useIntl();

  return (
    <Modal
      open={open}
      title={intl.formatMessage({ id: 'fileBrowser.upload.selectDirectoryTitle' })}
      okText={intl.formatMessage({ id: 'common.confirm' })}
      cancelText={intl.formatMessage({ id: 'common.cancel' })}
      confirmLoading={loading}
      okButtonProps={{ disabled: !canConfirm }}
      onOk={onOk}
      onCancel={onCancel}
      zIndex={1001}
      destroyOnClose
    >
      <Space direction="vertical" size={12} className={styles.modalContentStack}>
        <Typography.Text>
          {intl.formatMessage({ id: 'fileBrowser.copy.targetDirectory' })}
          {directoryPath}
        </Typography.Text>
        <Typography.Text type="secondary">
          {intl.formatMessage({ id: 'fileBrowser.upload.directoryScopeTip' })}
        </Typography.Text>
        <KnowledgeBreadcrumb
          folderPath={breadcrumb}
          handleBreadcrumbClick={(index) => {
            const target = breadcrumb[index];
            if (target) {
              onLoadFolders(target.id);
            }
          }}
        />
        <Spin spinning={loading}>
          <List
            dataSource={folders}
            locale={{ emptyText: intl.formatMessage({ id: 'fileBrowser.copy.noSubFolder' }) }}
            renderItem={(folder) => (
              <List.Item
                onClick={() => {
                  const targetPath = buildTargetFolderPath(directoryPath, folder.name);
                  if (!isAllowedUploadDirectoryTarget(targetPath, basePath)) {
                    onInvalidDirectory();
                    return;
                  }
                  onLoadFolders(targetPath);
                }}
                className={styles.clickableListItem}
              >
                <List.Item.Meta
                  avatar={<AntdIcon type="icon-wenjianjialanse" />}
                  title={<Typography.Text>{folder.name}</Typography.Text>}
                />
              </List.Item>
            )}
          />
        </Spin>
      </Space>
    </Modal>
  );
};

export default UploadDirectoryPickerModal;
