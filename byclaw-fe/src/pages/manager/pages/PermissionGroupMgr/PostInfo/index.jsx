import React, { useState } from 'react';
import { connect } from 'dva';
import { Tooltip } from 'antd';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import PostList from './PostList';
import styles from './index.module.less';
import classNames from 'classnames';
import KnowledgeBaseAuthor from '@/pages/manager/components/KnowledgeBaseAuthor';
import DigitalEmployeeAuthor from '@/pages/manager/components/DigitalEmployeeAuthor';

const PostInfo = (props) => {
  const { info } = props;

  const intl = useIntl();

  // 知识库弹窗
  const [baseVisible, setBaseVisible] = useState(false);
  // 数字员工弹窗、
  const [employeeVisible, setEmployeeVisible] = useState(false);
  // 弹窗入参
  const [initParams] = useState({});

  return (
    <>
      <div className={styles.container}>
        <div className={styles.topContainer}>
          <div className={styles.left}>
            <AntdIcon type="icon-a-Avatartouxiang" style={{ fontSize: 24 }} />
          </div>
          <div className={styles.middle}>
            <div className={styles.title}>{info?.positionName || intl.formatMessage({ id: 'postInfo.position' })}</div>
            <Tooltip placement="topLeft" title={info?.positionDesc || ' '}>
              <div className={styles.desc}>{info?.positionDesc || ' '}</div>
            </Tooltip>
          </div>
        </div>
      </div>
      {baseVisible && (
        <KnowledgeBaseAuthor
          drawerTitle={intl.formatMessage({ id: 'postInfo.authResource' })}
          visible={baseVisible}
          initParams={initParams}
          onCancel={() => {
            setBaseVisible(false);
          }}
          showTabs={false}
        />
      )}
      {employeeVisible && (
        <DigitalEmployeeAuthor
          drawerTitle={intl.formatMessage({ id: 'postInfo.authEmployee' })}
          visible={employeeVisible}
          initParams={initParams}
          onCancel={() => {
            setEmployeeVisible(false);
          }}
          showTabs={false}
        />
      )}
    </>
  );
};

const PostInfoWithConnect = connect()(PostInfo);

const PostInfoWarp = (props) => {
  const { infoLook } = props;

  return (
    <>
      <div className={classNames(styles.content, 'full-height full-width')}>
        {/* <div
          className={styles.trigger}
          onClick={() => setCollapsed(!collapsed)}
        >
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
        </div> */}
        <div className={styles.infoContainer}>
          <div className={styles.organization}>
            <PostInfoWithConnect info={infoLook} />
          </div>
          <div className={styles.member}>
            <PostList selectedPost={infoLook} record={infoLook} />
          </div>
        </div>
      </div>
    </>
  );
};

export default PostInfoWarp;
