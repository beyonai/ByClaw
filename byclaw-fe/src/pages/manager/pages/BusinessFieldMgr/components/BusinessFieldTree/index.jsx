import React, { useState, useMemo, useEffect } from 'react';
import { connect } from 'dva';
import { Tree, Input, Tooltip, Modal, message, Dropdown } from 'antd';
import { SearchOutlined, DeleteOutlined, EditOutlined, EllipsisOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import { arrayToTree } from '@/pages/manager/utils/managerUtils';
import styles from './index.module.less';

const { confirm, error } = Modal;

const BusinessFieldTree = ({
  onSelect,
  selectedField,
  setSelectedField,
  setVisible,
  setType,
  setInfo,
  treeData: dataSource,
  setTreeData,
  dispatch,
  setSearchValue,
  searchValue,
  getTree,
}) => {
  const intl = useIntl();
  const [expandedKeys, setExpandedKeys] = useState([]);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  // 获取用户权限信息
  useEffect(() => {
    dispatch({
      type: 'orgMgr/getIsOrgManager',
      success: (res) => {
        const { data } = res;
        const { userType } = data || {};
        // 只有平台管理员才能操作
        setIsPlatformAdmin(userType === 'PLAT_MAN');
      },
      fail: () => {
        setIsPlatformAdmin(false);
      },
    });
  }, [dispatch]);

  // 将扁平数组转换为树形结构
  const treeDataForTree = useMemo(() => {
    if (!dataSource || dataSource.length === 0) {
      return [];
    }

    // 先使用 arrayToTree 转换结构
    const result = arrayToTree(dataSource, {
      key: 'fieldId',
      label: 'fieldName',
      parentKey: 'parentFieldId',
      // sortKey: 'fieldIndex'
    });

    // 递归函数：将原始数据的所有字段合并到树节点中
    const enrichNode = (node, originalData) => {
      const originalItem = originalData.find((item) => item.fieldId === node.fieldId);
      if (originalItem) {
        // 保留所有原始字段
        Object.assign(node, originalItem);
      }
      // 递归处理子节点
      if (node.children && node.children.length > 0) {
        node.children.forEach((child) => enrichNode(child, originalData));
      }
    };

    // 为每个节点补充原始数据
    result.forEach((node) => enrichNode(node, dataSource));

    setExpandedKeys((p) => (p?.length === 0 && result?.length > 0 ? result.map((item) => item.fieldId) : [...p]));
    return result;
  }, [dataSource]);

  // 当树形结构准备好且没有选中节点时，自动选中第一个节点
  useEffect(() => {
    if (treeDataForTree?.length > 0 && !selectedField?.fieldId) {
      // 树节点已经包含了所有原始数据（通过 enrichNode 合并）
      const firstNode = treeDataForTree[0];
      if (firstNode && firstNode.fieldId) {
        setSelectedField(firstNode);
      }
    }
  }, [treeDataForTree, selectedField?.fieldId, setSelectedField]);

  // 处理删除操作
  const handleDelete = () => {
    dispatch({
      type: 'businessFieldMgr/deleteField',
      payload: {
        catalogId: selectedField?.fieldId || selectedField?.catalogId,
      },
      success: () => {
        message.success(intl.formatMessage({ id: 'common.deleteSuccess' }));
        setTreeData(dataSource.filter((item) => item.fieldId !== selectedField?.fieldId));
        setSelectedField?.(dataSource?.filter((item) => item.fieldId !== selectedField?.fieldId)?.[0] || {});
        getTree();
      },
      fail: (res) => {
        error({
          title: intl.formatMessage({ id: 'businessField.deleteTitle' }),
          content: res.msg || intl.formatMessage({ id: 'businessField.deleteFail' }),
        });
      },
    });
  };

  // 处理编辑操作
  const handleEdit = () => {
    setType('edit');
    setInfo(selectedField);
    setVisible(true);
  };

  const dropdownItems = [
    {
      key: 'edit',
      label: (
        <div className={styles.editBtn}>
          <EditOutlined />
          <span style={{ marginLeft: 5 }}>{intl.formatMessage({ id: 'common.edit' })}</span>
        </div>
      ),
    },
    {
      key: 'delete',
      label: (
        <div className={styles.deleteBtn}>
          <DeleteOutlined />
          <span style={{ marginLeft: 5 }}>{intl.formatMessage({ id: 'common.delete' })}</span>
        </div>
      ),
      danger: true,
    },
  ];

  const titleRender = (nodeData) => (
    <div className={styles.treeNode}>
      <div style={{ flex: 1, display: 'flex', columnGap: 2, alignItems: 'center' }}>
        <AntdIcon type="icon-a-changjing-line" />
        <div style={{ flex: 1, width: 0, height: 24 }}>
          <Tooltip title={nodeData.fieldName}>
            <span
              title=""
              style={{
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                display: 'inline-block',
                width: '100%',
                wordBreak: 'break-all',
              }}
            >
              {nodeData.fieldName}
            </span>
          </Tooltip>
        </div>
        {nodeData.fieldId === selectedField?.fieldId && isPlatformAdmin && (
          <Dropdown
            menu={{
              items: dropdownItems,
              onClick: ({ key }) => {
                if (key === 'delete') {
                  confirm({
                    title: intl.formatMessage({ id: 'businessField.deleteTitle' }),
                    content: intl.formatMessage({ id: 'businessField.deleteConfirm' }),
                    onOk: () => {
                      handleDelete();
                    },
                  });
                } else if (key === 'edit') {
                  handleEdit();
                }
              },
            }}
          >
            <div className={styles.actionIcon}>
              <EllipsisOutlined />
            </div>
          </Dropdown>
        )}
      </div>
    </div>
  );

  return (
    <div className={styles.treeContainer}>
      <div className={styles.header}>
        <span className={styles.title}>{intl.formatMessage({ id: 'businessField.title' })}</span>
        {isPlatformAdmin && (
          <AntdIcon
            className={styles.iconAdd}
            type="icon-a-Plusjia"
            onClick={() => {
              setVisible(true);
              setType('add');
              setInfo({});
            }}
          />
        )}
      </div>
      <Input
        placeholder={intl.formatMessage({ id: 'businessField.searchPlaceholder' })}
        prefix={<SearchOutlined />}
        onChange={(e) => setSearchValue(e.target.value)}
        value={searchValue}
        className={styles.searchInput}
      />
      <div style={{ flex: 1, overflow: 'auto', height: 0, marginTop: 16 }}>
        <Tree
          treeData={treeDataForTree}
          titleRender={titleRender}
          onSelect={(selectedKeys) => {
            const key = selectedKeys?.[0];
            // 注意：0 在 JS 中是“假值”，不能用 if(key) 判断，否则 id 为 0 选不中
            if (key === 0 || key) {
              onSelect(key);
            }
          }}
          fieldNames={{
            title: 'fieldName',
            key: 'fieldId',
            children: 'children',
          }}
          defaultExpandAll
          blockNode
          selectedKeys={[selectedField?.fieldId]}
          expandedKeys={expandedKeys}
          onExpand={(keys) => {
            setExpandedKeys(keys);
          }}
        />
      </div>
    </div>
  );
};

export default connect()(BusinessFieldTree);
