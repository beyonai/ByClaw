import React, { useCallback, useEffect, useState } from 'react';
import { App, Modal, Spin, Tree } from 'antd';
import { FolderOutlined } from '@ant-design/icons';
// @ts-ignore
import { useIntl } from '@umijs/max';
import { queryDirAndFileByLevel } from '@/service/knowledgeCenter';
import { isInvalidMoveTarget, normalizeMovePath } from '../../DirectoryManage/moveUtils';
import styles from './index.module.less';

interface MoveModalProps {
  visible: boolean;
  resourceId: number;
  sourceDirectoryPaths: string[];
  loading?: boolean;
  onCancel: () => void;
  onOk: (targetDirectoryPath: string) => void;
}

interface MoveTreeNode {
  title: string;
  key: string;
  icon: React.ReactNode;
  children?: MoveTreeNode[];
  isLeaf?: boolean;
  disabled?: boolean;
}

function updateTreeData(list: MoveTreeNode[], key: string, children: MoveTreeNode[]): MoveTreeNode[] {
  return list.map((node) => {
    if (node.key === key) {
      return { ...node, children };
    }
    if (node.children) {
      return { ...node, children: updateTreeData(node.children, key, children) };
    }
    return node;
  });
}

const MoveModal: React.FC<MoveModalProps> = ({
  visible,
  resourceId,
  sourceDirectoryPaths,
  loading,
  onCancel,
  onOk,
}) => {
  const intl = useIntl();
  const { message } = App.useApp();
  const [treeData, setTreeData] = useState<MoveTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState('/');

  const loadChildren = useCallback(
    async (directoryPath: string): Promise<MoveTreeNode[]> => {
      const response = await queryDirAndFileByLevel({ resourceId, directoryPath });
      const rows = Array.isArray(response) ? response : [];
      return rows
        .filter((item) => item?.type === 'directory')
        .map((item) => {
          const path = normalizeMovePath(item.directoryPath || `${directoryPath}/${item.name}`);
          return {
            title: item.name,
            key: path,
            icon: <FolderOutlined />,
            isLeaf: false,
            disabled: isInvalidMoveTarget(path, sourceDirectoryPaths),
          };
        });
    },
    [resourceId, sourceDirectoryPaths]
  );

  useEffect(() => {
    if (!visible) return;
    setSelectedPath('/');
    setTreeLoading(true);
    loadChildren('/')
      .then((children) => {
        setTreeData([
          {
            title: intl.formatMessage({ id: 'directoryManage.allFiles' }),
            key: '/',
            icon: <FolderOutlined />,
            children,
          },
        ]);
      })
      .catch((error) => {
        const errorMessage = typeof error === 'string' ? error : error?.message;
        message.error(errorMessage || intl.formatMessage({ id: 'directoryManage.loadMoveDirectoriesFailed' }));
        setTreeData([]);
      })
      .finally(() => setTreeLoading(false));
  }, [intl, loadChildren, message, visible]);

  const handleLoadData = async (node: any) => {
    if (node.children) return;
    try {
      const children = await loadChildren(String(node.key));
      setTreeData((prev) => updateTreeData(prev, String(node.key), children));
    } catch (error: any) {
      const errorMessage = typeof error === 'string' ? error : error?.message;
      message.error(errorMessage || intl.formatMessage({ id: 'directoryManage.loadMoveDirectoriesFailed' }));
    }
  };

  return (
    <Modal
      open={visible}
      title={intl.formatMessage({ id: 'directoryManage.moveTo' })}
      onCancel={onCancel}
      onOk={() => onOk(selectedPath)}
      confirmLoading={loading}
      okButtonProps={{ disabled: !selectedPath || isInvalidMoveTarget(selectedPath, sourceDirectoryPaths) }}
      cancelButtonProps={{ disabled: loading }}
      closable={!loading}
      maskClosable={!loading}
      destroyOnClose
      width={640}
    >
      <Spin spinning={treeLoading}>
        <div className={styles.container}>
          <Tree
            className={styles.tree}
            treeData={treeData}
            loadData={handleLoadData}
            selectedKeys={[selectedPath]}
            defaultExpandedKeys={['/']}
            onSelect={(keys) => {
              if (keys.length) setSelectedPath(String(keys[0]));
            }}
            blockNode
            showIcon
          />
        </div>
      </Spin>
    </Modal>
  );
};

export default MoveModal;
