import React, { useEffect, useState, useCallback } from 'react';
import { debounce } from 'lodash';
import { message } from 'antd';
import { useDispatch, useIntl } from '@umijs/max';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import BusinessFieldTree from './components/BusinessFieldTree';
import BusinessFieldInfo from './BusinessFieldInfo';
import BusinessFieldAssets from './BusinessFieldAssets';
import BusinessFieldInfoModal from './components/BusinessFieldInfoModal';
import styles from './index.module.less';

const BusinessFieldMgr = () => {
  const dispatch = useDispatch();
  const intl = useIntl();

  const [selectedField, setSelectedField] = useState(null);
  const [visible, setVisible] = useState(false);
  const [type, setType] = useState('add');
  const [info, setInfo] = useState({});
  const [collapsed, setCollapsed] = useState(false);
  const [treeData, setTreeData] = useState([]);
  const [searchValue, setSearchValue] = useState('');
  //console.log(treeData)
  // 获取业务领域树数据
  const getTree = useCallback(() => {
    dispatch({
      type: 'businessFieldMgr/getFieldTree',
      payload: {
        keyword: searchValue,
        // ...(searchValue?.length > 0 ? { containsParent: true } : {}),
      },
      success: (res) => {
        const { data } = res;
        // 将接口返回的 catalogId、catalogName 等字段映射为组件使用的字段
        const mappedData = (data || []).map((item) => ({
          ...item,
          fieldId: item.catalogId,
          fieldName: item.catalogName,
          fieldDesc: item.catalogDesc || item.remark,
          parentFieldId: item.pCatalogId || item.parentCatalogId || item.pcatalogId,
          // 排序字段统一使用后端的 orderIndex
          fieldIndex: item.orderIndex,
        }));
        setTreeData(mappedData);

        // 如果当前已经选中了某个领域，则在最新的树数据中同步这条记录
        if (selectedField?.fieldId) {
          const current = mappedData.find(
            (item) => item.fieldId === selectedField.fieldId || item.catalogId === selectedField.catalogId
          );
          if (current) {
            setSelectedField(current);
          }
          // 如果当前选中的节点不存在了，不在这里处理，交给树组件自动选中第一个节点
        }
        // 默认选中第一个节点的逻辑已移到树组件中处理，避免重复转换
      },
      fail: (res) => {
        message.warning(res?.msg || intl.formatMessage({ id: 'businessField.getListFail' }));
      },
    });
  }, [dispatch, searchValue, selectedField?.fieldId, selectedField?.catalogId]);

  useEffect(() => {
    getTree();
  }, []);

  useEffect(() => {
    const debouncedFn = debounce(() => {
      getTree();
    }, 300);
    debouncedFn();
    return () => {
      debouncedFn.cancel();
    };
  }, [searchValue]);

  return (
    <div className={styles.container}>
      {!collapsed && (
        <div className={styles.sider}>
          <BusinessFieldTree
            treeData={treeData}
            selectedField={selectedField}
            setSelectedField={setSelectedField}
            onSelect={(val) => {
              const node = treeData.find((item) => item.catalogId === val);
              setSelectedField(node);
            }}
            setVisible={setVisible}
            setType={setType}
            setInfo={setInfo}
            getTree={getTree}
            setTreeData={setTreeData}
            setSearchValue={setSearchValue}
            searchValue={searchValue}
          />
        </div>
      )}
      <div className={styles.content}>
        <div className={styles.trigger} onClick={() => setCollapsed(!collapsed)}>
          <div className={styles.triggerTop} />
          <div
            style={{
              background: '#e6ebf0',
              height: 50,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            {collapsed ? <RightOutlined /> : <LeftOutlined />}
          </div>
          <div className={styles.triggerBottom} />
        </div>
        <div className={styles.infoContainer}>
          <div className={styles.organization}>
            <BusinessFieldInfo
              selectedField={selectedField}
              setVisible={setVisible}
              setType={setType}
              setInfo={setInfo}
            />
          </div>
          <div className={styles.member}>
            <BusinessFieldAssets selectedField={selectedField} />
          </div>
        </div>
      </div>
      {visible && (
        <BusinessFieldInfoModal
          visible={visible}
          type={type}
          record={info}
          onCancel={() => {
            setVisible(false);
          }}
          onOk={() => {
            setVisible(false);
            getTree();
          }}
        />
      )}
    </div>
  );
};

export default BusinessFieldMgr;
