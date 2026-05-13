import React, { useEffect, useState } from 'react';
import { connect } from 'dva';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import styles from './index.module.less';

const BusinessFieldInfo = (props) => {
  const { selectedField, setVisible, setType, setInfo } = props;

  return (
    <div className={styles.container}>
      <div className={styles.topContainer}>
        <div className={styles.left}>
          <AntdIcon type="icon-changjing-fill" style={{ fontSize: 30, color: '#4080FF' }} />
        </div>
        <div className={styles.middle}>
          <div className={styles.title}>
            {selectedField?.fieldName || ' '}
            {/* {selectedField?.fieldId && (
              <div
                className={styles.edit}
                onClick={() => {
                  setVisible(true);
                  setType('edit');
                  setInfo(selectedField);
                }}
              >
                <EditOutlined />
              </div>
            )} */}
          </div>
          <div className={styles.desc}>{selectedField?.fieldDesc || ' '}</div>
        </div>
        {/* <div className={styles.right}>
          <Button
            type="primary"
            onClick={() => {
              setVisible(true);
              setType('add');
              setInfo({ parentFieldId: selectedField?.fieldId });
            }}
          >
            + 新增
          </Button>
        </div> */}
      </div>
    </div>
  );
};

export default connect()(BusinessFieldInfo);
