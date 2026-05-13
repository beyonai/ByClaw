import React from 'react';
import { connect } from 'dva';
import { Tooltip } from 'antd';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import styles from './index.module.less';

const PostInfo = (props) => {
  const { info, setShowInfo, setType, setInfo } = props;

  const intl = useIntl();

  return (
    <div className={styles.container}>
      <div className={styles.topContainer}>
        <div className={styles.left}>
          <AntdIcon type="icon-a-Avatartouxiang" style={{ fontSize: 24 }} />
        </div>
        <div className={styles.middle}>
          <div className={styles.title}>
            {info?.positionName || intl.formatMessage({ id: 'postInfo.position' })}
            {!info?.userId && !info?.noAction && (
              <AntdIcon
                type="icon-a-Editbianji"
                className={styles.iconEdit}
                onClick={() => {
                  setShowInfo(true);
                  setType('edit');
                  setInfo(info);
                }}
              />
            )}
          </div>
          <Tooltip placement="topLeft" title={info?.positionDesc || ' '}>
            <div className={styles.desc}>{info?.positionDesc || ' '}</div>
          </Tooltip>
        </div>
        <div className={styles.right}></div>
      </div>
    </div>
  );
};

export default connect()(PostInfo);
