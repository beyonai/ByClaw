import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Input, Breadcrumb, Tree, Spin, App, ConfigProvider, Dropdown } from 'antd';
import { EllipsisOutlined, LeftOutlined } from '@ant-design/icons';
import classnames from 'classnames';
import { AntdTreeNodeAttribute, EventDataNode } from 'antd/es/tree';
import AntdIcon from '@/components/AntdIcon';
import { useIntl, useSelector } from '@umijs/max';
import useVirtualHeight from '@/hooks/useVirtualHeight';
import { downloadResourceFile } from '@/service/file';
import { resolveTreeItemDirectoryPath } from './service';
import type { QueryDirAndFileByLevelItem } from '@/service/knowledgeCenter';
import { downloadFile } from '@/utils/file';
import useShowModal from '@/hooks/useShowModal';
import RenameModal from '@/pages/knowledgeDetail/components/RenameModal';
import { IDragType, DragType, onTreeNodeDragStart } from '@/components/QueryInput/withDrag';
import { IKnowledgeBaseItem, IKnowledgeCollectionItem, IKnowledgeDetailTreeItem } from './types';
import { delFolderOrFile, qryFolderAndFileList } from './service';
import { deleteTreeNode, updateTreeNode } from './utils';
import commonStyles from '../common.module.less';
import styles from './index.module.less';
import { TreeProps } from 'antd/lib';

interface KnowledgeBaseDetailProps {
  editable?: boolean;
  dataset: IKnowledgeBaseItem;
  onGoBack: () => void;
  onSelect?: (item: IKnowledgeCollectionItem, type: IDragType) => void;
}

function onDragStart(info: Parameters<Required<TreeProps>['onDragStart']>[0]) {
  const data = info.node as unknown as IKnowledgeDetailTreeItem;
  onTreeNodeDragStart(info.event, data, data.type === 'file' ? DragType.file : DragType.folder);
}

function getNodeIcon(p: AntdTreeNodeAttribute) {
  const { isLeaf, title } = p;
  if (!isLeaf) {
    return <AntdIcon type="icon-wenjianjialanse" />;
  }
  let iconType = '';
  const v = title as string;
  if (/\.(doc|docx)$/.test(v)) {
    iconType = 'Word';
  } else if (v?.endsWith('.pdf')) {
    iconType = 'PDF';
  } else if (/\.(xls|xlsx)$/.test(v)) {
    iconType = 'Excel';
  } else if (v?.endsWith('.txt')) {
    iconType = 'jishiben';
  } else if (v?.endsWith('.ppt')) {
    iconType = 'PPT';
  } else if (/\.(png|jpg|jpeg)$/.test(v)) {
    iconType = 'Image';
  }

  return <AntdIcon type={`icon-${iconType}`} />;
}

const KnowledgeBaseDetail = (props: KnowledgeBaseDetailProps) => {
  const { editable, dataset, onGoBack, onSelect } = props;
  const [searchValue, setSearchValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [treeData, setTreeData] = useState<IKnowledgeDetailTreeItem[]>([]);
  const treeWrap = useRef<HTMLDivElement>(null);
  const virtualHeight = useVirtualHeight(treeWrap);
  const { userInfo } = useSelector(({ user }: any) => ({
    userInfo: user.userInfo,
  }));

  const intl = useIntl();
  const { modal, message } = App.useApp();
  const [modalState, modalAction] = useShowModal();

  const qryFlatternList = async (parentId: string) => {
    if (parentId === '-1') {
      setLoading(true);
      setTreeData([]);
    }
    let result: IKnowledgeDetailTreeItem[] = [];
    try {
      const resourceId = Number(dataset.resourceId);
      const directoryPath = parentId === '-1' ? '/' : String(parentId);
      const response = await qryFolderAndFileList({
        resourceId,
        directoryPath,
      });
      const datasetId = String(dataset.resourceSourcePkId ?? dataset.resourceId ?? '');
      result = (response || []).map((item: QueryDirAndFileByLevelItem) => {
        const pathKey =
          String(item.directoryPath ?? '').trim() ||
          String(item.id !== null && item.id !== undefined ? item.id : `${directoryPath}/${item.name}`);
        return {
          id: String(item.id ?? ''),
          collectionName: item.name,
          datasetId,
          type: item.type,
          fileId: item.fileId !== null && item.fileId !== undefined ? String(item.fileId) : undefined,
          parentId: String(parentId),
          directoryPath: item.directoryPath,

          title: item.name,
          key: pathKey,
          isLeaf: item.type === 'file',
        };
      }) as IKnowledgeDetailTreeItem[];
      const kw = searchValue.trim().toLowerCase();
      if (kw) {
        result = result.filter((r) => String(r.title).toLowerCase().includes(kw));
      }
      if (parentId === '-1') {
        setTreeData(result);
      }
    } catch (error) {
      console.log(error);
    } finally {
      setLoading(false);
    }
    return result;
  };

  useEffect(() => {
    qryFlatternList('-1');
  }, [searchValue]);

  const expandFolder = ({ key, children }: EventDataNode<IKnowledgeDetailTreeItem>) =>
    new Promise<void>((resolve) => {
      if (children) {
        resolve();
        return;
      }
      qryFlatternList(key).then((result) => {
        setTreeData((origin) => updateTreeNode(origin, key, { children: result }));
        resolve();
      });
    });

  const onMenuItemClick = useCallback(
    (key: string, item: IKnowledgeDetailTreeItem) => {
      if (key === 'rename') {
        modalAction.handleShow('edit', item);
      } else if (key === 'delete') {
        modal.confirm({
          title: intl.formatMessage({ id: 'common.deleteTips' }),
          content: item.title,
          onOk: () =>
            new Promise<void>((resolve) => {
              delFolderOrFile(item, String(dataset.resourceId))
                .then(() => {
                  message.success(intl.formatMessage({ id: 'common.deleteSuccess' }));
                  setTreeData((prev) => deleteTreeNode(prev, key));
                })
                .finally(resolve);
            }),
        });
      } else if (key === 'download') {
        const directoryPath = resolveTreeItemDirectoryPath(item);
        if (!directoryPath) {
          message.warning('无法解析文件路径');
          return;
        }
        message.loading('');
        downloadResourceFile({
          resourceId: dataset.resourceId,
          directoryPath,
        }).then((res) => {
          message.destroy();
          downloadFile(res);
        });
      }
    },
    [dataset.resourceId, intl, message, modal, modalAction]
  );

  return (
    <ConfigProvider>
      <div className={commonStyles.container}>
        <div className={commonStyles.searchArea}>
          <Breadcrumb
            className={commonStyles.breadcrumb}
            style={{ marginTop: 0 }}
            items={[
              {
                key: '-1',
                title: (
                  <span>
                    <LeftOutlined />
                    {intl.formatMessage({ id: 'dialogueRecord.all' })}
                  </span>
                ),
                onClick: onGoBack,
              },
              { key: dataset.resourceId, title: dataset.resourceName },
            ]}
          />
          <div className={commonStyles.searchControls}>
            <Input.Search
              allowClear
              placeholder={intl.formatMessage({ id: 'selectMember.searchPlaceholder' })}
              onSearch={setSearchValue}
              className={commonStyles.searchInput}
            />
          </div>
        </div>
        <Spin spinning={loading} wrapperClassName={commonStyles.listSpinner}>
          <div ref={treeWrap} style={{ height: '100%' }}>
            <Tree.DirectoryTree
              showIcon
              allowDrop={() => false}
              onDragStart={onDragStart}
              selectable={false}
              height={virtualHeight}
              treeData={treeData}
              loadData={expandFolder}
              icon={getNodeIcon}
              className={classnames(commonStyles.tree, {
                [styles.selectable]: !!onSelect,
                [styles.notselectable]: !onSelect,
              })}
              onClick={(e, node) => {
                onSelect?.(node, node.type === 'file' ? DragType.file : DragType.folder);
              }}
              draggable={editable ? { icon: <span /> } : false}
              titleRender={(item) => {
                if (!editable) {
                  return item.title;
                }
                const menus = [];
                if (`${item.createUserId}` === `${userInfo.userId}`) {
                  menus.push(
                    { key: 'rename', label: intl.formatMessage({ id: 'directoryManage.rename' }) },
                    { key: 'delete', label: intl.formatMessage({ id: 'common.delete' }) }
                  );
                }
                if (item.type === 'file') {
                  menus.unshift({
                    key: 'download',
                    label: intl.formatMessage({ id: 'common.download' }),
                  });
                }
                return (
                  <>
                    {item.title}
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: menus,
                        onClick: ({ key }) => onMenuItemClick(key, item),
                      }}
                    >
                      <EllipsisOutlined className={commonStyles.treeActionIcon} />
                    </Dropdown>
                  </>
                );
              }}
            />
          </div>
        </Spin>
      </div>
      <RenameModal
        {...modalState}
        onCancel={modalAction.onCancel}
        resourceId={dataset.resourceId}
        onSuccess={async () => {
          await qryFlatternList('-1');
        }}
      />
    </ConfigProvider>
  );
};

export default KnowledgeBaseDetail;
