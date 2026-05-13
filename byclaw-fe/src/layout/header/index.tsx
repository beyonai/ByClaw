import React from 'react';

// @ts-ignore
import { SelectLang, useIntl, useSelector } from '@umijs/max';
import { Button, Space } from 'antd';
import useAppStore from '@/models/common/useAppStore';
import styles from './index.module.less';
import { getSystemIcon } from '@/utils/system';
import NullableAntdCompWithAnim from '@/components/NullableAntdCompWithAnim';

const LoginModal = React.lazy(() => import('@/components/LoginModal'));

const HeaderPage = () => {
  const intl = useIntl();

  const { setLoginModalOpen, isLoginModalOpen } = useAppStore();

  const { userInfo } = useSelector(({ user }: any) => ({
    userInfo: user.userInfo,
  }));

  const renderHeader = () => (
    <div className={styles.headerBox}>
      <div className={styles.headerLeft}>
        <div className={styles.logoWrap}>
          <img className={styles.logo} src={getSystemIcon()} alt="BYAI" />
        </div>
      </div>
      <div className={styles.headerRight}>
        <SelectLang className={styles.intlIcon} />
        {!userInfo && (
          <Space>
            <Button type="primary" variant="filled" onClick={() => setLoginModalOpen(true)}>
              {intl.formatMessage({ id: 'contentHeader.login' })}
            </Button>
          </Space>
        )}
      </div>
    </div>
  );

  return (
    <div className={styles.header}>
      {/* 头部区域 */}
      {renderHeader()}
      <NullableAntdCompWithAnim open={isLoginModalOpen}>
        <React.Suspense fallback={null}>
          {/* 登录框 */}
          <LoginModal open={isLoginModalOpen} onClose={() => setLoginModalOpen(false)} />
        </React.Suspense>
      </NullableAntdCompWithAnim>
    </div>
  );
};

export default HeaderPage;
