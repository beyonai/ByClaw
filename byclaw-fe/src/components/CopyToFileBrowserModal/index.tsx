import React from 'react';
import { List, Modal, Space, Spin, Typography } from 'antd';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import KnowledgeBreadcrumb from '@/components/KnowledgeBreadcrumb';
import type { FileBrowserItem } from '@/service/fileBrowser';
import styles from './index.module.less';

export type FileBrowserCopyTargetType = 'session' | 'shared';

export type FileBrowserFolderPathItem = {
  id: string;
  title: string;
};

interface CopyToFileBrowserModalProps {
  open: boolean;
  targetType: FileBrowserCopyTargetType;
  sourceName?: React.ReactNode;
  targetDirectory: string;
  folderPath: FileBrowserFolderPathItem[];
  folders: FileBrowserItem[];
  loading?: boolean;
  confirmLoading?: boolean;
  onOk: () => void;
  onCancel: () => void;
  onBreadcrumbClick: (folder: FileBrowserFolderPathItem, index: number) => void;
  onFolderClick: (folder: FileBrowserItem) => void;
}

const CopyToFileBrowserModal: React.FC<CopyToFileBrowserModalProps> = ({
  open,
  targetType,
  sourceName,
  targetDirectory,
  folderPath,
  folders,
  loading,
  confirmLoading,
  onOk,
  onCancel,
  onBreadcrumbClick,
  onFolderClick,
}) => {
  const intl = useIntl();

  return (
    <Modal
      open={open}
      title={intl.formatMessage({
        id: targetType === 'session' ? 'fileBrowser.copy.toSessionTitle' : 'fileBrowser.copy.toSharedTitle',
      })}
      okText={intl.formatMessage({ id: 'common.confirm' })}
      cancelText={intl.formatMessage({ id: 'common.cancel' })}
      confirmLoading={confirmLoading}
      onOk={onOk}
      onCancel={onCancel}
      destroyOnClose
    >
      <Space direction="vertical" size={12} className={styles.modalContentStack}>
        <Typography.Text type="secondary">
          {intl.formatMessage({ id: 'fileBrowser.copy.source' })}
          {sourceName}
        </Typography.Text>
        <Typography.Text>
          {intl.formatMessage({ id: 'fileBrowser.copy.targetDirectory' })}
          {targetDirectory}
        </Typography.Text>
        <KnowledgeBreadcrumb
          folderPath={folderPath}
          handleBreadcrumbClick={(index) => {
            const target = folderPath[index];
            if (target) {
              onBreadcrumbClick(target, index);
            }
          }}
        />
        <Spin spinning={loading}>
          <div className={styles.folderListWrap}>
            <List
              dataSource={folders}
              locale={{ emptyText: intl.formatMessage({ id: 'fileBrowser.copy.noSubFolder' }) }}
              renderItem={(folder) => (
                <List.Item onClick={() => onFolderClick(folder)} className={styles.clickableListItem}>
                  <List.Item.Meta
                    avatar={<AntdIcon type="icon-wenjianjialanse" />}
                    title={<Typography.Text>{folder.name}</Typography.Text>}
                  />
                </List.Item>
              )}
            />
          </div>
        </Spin>
      </Space>
    </Modal>
  );
};

export default CopyToFileBrowserModal;
