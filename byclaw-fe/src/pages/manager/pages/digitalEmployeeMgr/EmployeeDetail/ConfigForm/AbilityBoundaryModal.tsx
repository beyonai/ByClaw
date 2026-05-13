// @ts-nocheck
import React, { useEffect, useState } from 'react';

import { Modal, Tabs, Input, Button } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';

import styles from './index.module.less';

const { TextArea } = Input;
const { TabPane } = Tabs;

/**
 * 能力边界配置弹窗
 *  - 接受边界 / 拒绝边界 两个 Tab
 *  - 每个 Tab 支持多条边界项增删
 *  - 底部文案预览区仅做展示，不参与编辑
 */
const AbilityBoundaryModal = (props) => {
  const intl = useIntl();
  const { open, onOk, onCancel, ability, isReadOnly } = props;

  const [activeKey, setActiveKey] = useState('accept');
  const [acceptList, setAcceptList] = useState([]);
  const [rejectList, setRejectList] = useState([]);

  useEffect(() => {
    if (!ability) return;
    setAcceptList(ability.acceptBoundary || []);
    setRejectList(ability.rejectBoundary || []);
  }, [ability]);

  const handleAdd = (type) => {
    if (isReadOnly) return;
    if (type === 'accept') {
      setAcceptList([...(acceptList || []), '']);
    } else {
      setRejectList([...(rejectList || []), '']);
    }
  };

  const handleChange = (type, index, value) => {
    if (type === 'accept') {
      const list = [...acceptList];
      list[index] = value;
      setAcceptList(list);
    } else {
      const list = [...rejectList];
      list[index] = value;
      setRejectList(list);
    }
  };

  const handleRemove = (type, index) => {
    if (isReadOnly) return;
    if (type === 'accept') {
      setAcceptList(acceptList.filter((_, i) => i !== index));
    } else {
      setRejectList(rejectList.filter((_, i) => i !== index));
    }
  };

  const handleOk = () => {
    if (onOk) {
      onOk({
        acceptBoundary: (acceptList || []).filter((item) => item && item.trim()),
        rejectBoundary: (rejectList || []).filter((item) => item && item.trim()),
      });
    }
  };

  const renderList = (type) => {
    const list = type === 'accept' ? acceptList : rejectList;
    const placeholder =
      type === 'accept'
        ? intl.formatMessage({ id: 'employeeDetail.acceptBoundaryPlaceholder' })
        : intl.formatMessage({ id: 'employeeDetail.rejectBoundaryPlaceholder' });

    return (
      <div className={styles.boundaryList}>
        {(list || []).map((item, index) => (
          <div key={[type, index].join()} className={styles.boundaryItem}>
            <TextArea
              value={item}
              placeholder={placeholder}
              onChange={(e) => handleChange(type, index, e.target.value)}
              disabled={isReadOnly}
              autoSize={{ minRows: 1, maxRows: 3 }}
            />
            {!isReadOnly && (
              <DeleteOutlined
                className={styles.boundaryDeleteIcon}
                onClick={() => {
                  handleRemove(type, index);
                }}
              />
            )}
          </div>
        ))}
        {!isReadOnly && (
          <Button
            type="dashed"
            block
            icon={<PlusOutlined />}
            onClick={() => handleAdd(type)}
            className={styles.boundaryAddBtn}
          >
            {intl.formatMessage({ id: 'common.plus' })}
          </Button>
        )}
      </div>
    );
  };
  return (
    <Modal
      open={open}
      title={
        ability?.name
          ? intl.formatMessage({ id: 'employeeDetail.abilityBoundaryTitle' }, { name: ability.name })
          : intl.formatMessage({ id: 'employeeDetail.abilityBoundary' })
      }
      onOk={handleOk}
      onCancel={onCancel}
      width={720}
      okButtonProps={{ disabled: isReadOnly }}
      destroyOnHidden
      maskClosable={false}
      bodyStyle={{ padding: '0 24px', overflow: 'auto' }}
    >
      <div className={styles.boundaryModal}>
        <Tabs activeKey={activeKey} onChange={setActiveKey}>
          <TabPane tab={intl.formatMessage({ id: 'employeeDetail.acceptBoundary' })} key="accept">
            {renderList('accept')}
          </TabPane>
          <TabPane tab={intl.formatMessage({ id: 'employeeDetail.rejectBoundary' })} key="reject">
            {renderList('reject')}
          </TabPane>
        </Tabs>
      </div>
    </Modal>
  );
};

export default AbilityBoundaryModal;
