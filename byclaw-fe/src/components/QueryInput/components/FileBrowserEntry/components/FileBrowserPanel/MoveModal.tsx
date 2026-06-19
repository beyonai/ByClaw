import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Spin, Tree } from 'antd';
import { FolderOutlined } from '@ant-design/icons';
// @ts-ignore
import { useIntl } from '@umijs/max';
import { listFiles } from '@/service/fileBrowser';

interface MoveModalProps {
  open: boolean;
  resourceId: string | number;
  onOk: (targetDirectory: string) => void;
  onCancel: () => void;
  loading?: boolean;
}

interface TreeNode {
  title: string;
  key: string;
  icon: React.ReactNode;
  children?: TreeNode[];
  isLeaf?: boolean;
}

function updateTreeData(list: TreeNode[], key: string, children: TreeNode[]): TreeNode[] {
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

const MoveModal: React.FC<MoveModalProps> = ({ open, resourceId, onOk, onCancel, loading }) => {
  const intl = useIntl();
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string>('/');

  const loadChildren = useCallback(
    async (path: string): Promise<TreeNode[]> => {
      const res: any = await listFiles({ resourceId, path });
      const items = res?.data || res || [];
      return items
        .filter((item: any) => item.isDir || item.dir)
        .map((item: any) => ({
          title: item.name,
          key: item.path,
          icon: <FolderOutlined style={{ color: '#faad14' }} />,
          isLeaf: false,
        }));
    },
    [resourceId]
  );

  useEffect(() => {
    if (!open) return;
    setSelectedKey('/');
    setTreeLoading(true);
    loadChildren('/')
      .then((nodes) => {
        setTreeData([
          {
            title: '/',
            key: '/',
            icon: <FolderOutlined style={{ color: '#faad14' }} />,
            children: nodes,
          },
        ]);
      })
      .finally(() => setTreeLoading(false));
  }, [open, loadChildren]);

  const onLoadData = async (node: any) => {
    if (node.children?.length) return;
    const children = await loadChildren(node.key);
    setTreeData((prev) => updateTreeData(prev, node.key, children));
  };

  return (
    <Modal
      title={intl.formatMessage({ id: 'fileBrowser.move.title' })}
      open={open}
      onOk={() => onOk(selectedKey)}
      onCancel={onCancel}
      confirmLoading={loading}
      okButtonProps={{ disabled: !selectedKey }}
      destroyOnClose
    >
      <Spin spinning={treeLoading}>
        <Tree
          showIcon
          treeData={treeData}
          loadData={onLoadData}
          selectedKeys={[selectedKey]}
          onSelect={(keys) => {
            if (keys.length) setSelectedKey(keys[0] as string);
          }}
          defaultExpandedKeys={['/']}
          style={{ minHeight: 200 }}
        />
      </Spin>
    </Modal>
  );
};

export default MoveModal;
