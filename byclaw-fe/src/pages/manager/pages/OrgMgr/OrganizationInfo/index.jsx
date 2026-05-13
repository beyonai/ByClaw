import React, { useEffect, useState } from 'react';
import { connect } from 'dva';
import { message } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import styles from './index.module.less';

const OrganizationInfo = (props) => {
  const { selectedOrg, setVisible, setType, setInfo, dispatch } = props;

  const intl = useIntl();

  const [record, setRecord] = useState({});
  useEffect(() => {
    if (selectedOrg?.orgId) {
      dispatch({
        type: 'orgMgr/searchOrg',
        payload: {
          orgId: selectedOrg.orgId,
        },
        success: (res) => {
          const { data } = res || {};
          setRecord(data || {});
        },
        fail: (res) => {
          message.warning(res?.msg);
        },
      });
    }
  }, [dispatch, selectedOrg]);

  return (
    <div className={styles.container}>
      <div className={styles.topContainer}>
        <div className={styles.left}>
          <AntdIcon type="icon-zuzhitubiao" style={{ fontSize: 48 }} />
        </div>
        <div className={styles.middle}>
          <div className={styles.title}>
            <div className={styles.orgname}>{record.orgName || ' '}</div>
            <div
              className={styles.edit}
              onClick={() => {
                setVisible(true);
                setType('edit');
                setInfo(record);
              }}
            >
              <EditOutlined />
            </div>
          </div>

          <div className={styles.info}>
            {record.orgDesc && (
              <>
                <div className={styles.desc}>{record.orgDesc}</div>
                <span style={{ height: '12px', width: '1px', background: '#ccc', alignItems: 'center' }}></span>
              </>
            )}
            <div className={styles.content}>
              <div className={styles.item}>
                <div className={styles.label}>{intl.formatMessage({ id: 'orgMgr.organization.parent' })}：</div>
                <div className={styles.value}>{record.parentOrgName || ' '}</div>
              </div>
            </div>
          </div>
        </div>
        <div className={styles.right}></div>
      </div>
    </div>
  );
};

export default connect()(OrganizationInfo);
