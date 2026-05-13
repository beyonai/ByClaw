// @ts-nocheck
import React, { useEffect, useState } from 'react';

import { Modal, Input, Button } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';

import styles from './index.module.less';

const AbilityExampleModal = (props) => {
  const intl = useIntl();
  const { open, onOk, onCancel, ability, isReadOnly } = props;

  const [examples, setExamples] = useState([]);

  useEffect(() => {
    if (!ability) return;
    setExamples(ability.example || []);
  }, [ability]);

  const handleAdd = () => {
    if (isReadOnly) return;
    setExamples([...(examples || []), '']);
  };

  const handleChange = (index, value) => {
    const list = [...examples];
    list[index] = value;
    setExamples(list);
  };

  const handleRemove = (index) => {
    if (isReadOnly) return;
    setExamples(examples.filter((_, i) => i !== index));
  };

  const handleOk = () => {
    if (onOk) {
      onOk((examples || []).filter((item) => item && item.trim()));
    }
  };

  return (
    <Modal
      open={open}
      title={
        ability?.name
          ? intl.formatMessage({ id: 'employeeDetail.exampleQuestionTitle' }, { name: ability.name })
          : intl.formatMessage({ id: 'employeeDetail.exampleQuestionTitle' }, { name: '' })
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
        <div className={styles.boundaryList}>
          {(examples || []).map((item, index) => (
            <div key={index} className={styles.boundaryItem}>
              <Input
                value={item}
                placeholder={intl.formatMessage({ id: 'employeeDetail.exampleQuestionPlaceholder' })}
                onChange={(e) => handleChange(index, e.target.value)}
                disabled={isReadOnly}
              />
              {!isReadOnly && (
                <DeleteOutlined
                  className={styles.boundaryDeleteIcon}
                  onClick={() => {
                    handleRemove(index);
                  }}
                />
              )}
            </div>
          ))}
          {!isReadOnly && (
            <Button type="dashed" block icon={<PlusOutlined />} onClick={handleAdd} className={styles.boundaryAddBtn}>
              {intl.formatMessage({ id: 'employeeDetail.addQuestion' })}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default AbilityExampleModal;
