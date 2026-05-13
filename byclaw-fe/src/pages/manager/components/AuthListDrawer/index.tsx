// @ts-nocheck
import React, { useCallback } from 'react';
import { Row, Col, Spin, message } from 'antd';
import { useIntl, useDispatch, connect } from '@umijs/max';
import ModalDrawer from '@/pages/manager/components/ModalDrawer';
import AuthList from './AuthList';
import AddAuthModal from './AddAuthModal';
import { showPublishConfirm } from '@/pages/manager/utils/publishConfirm';
import styles from './index.module.less';
import useAuth from '@/pages/manager/hooks/useAuth';

const AuthListDrawer = (props) => {
  const {
    // useAuth | mgrAuth 使用授权、管理授权
    authType,
    // 操作记录
    record,
    onCancel,
    // 顶部显示信息
    headerInfo: { title, content, icon } = {},
    showBlack = true,
    onlyView = false,
    onlyUser = false,
    showPost = true,
    showStation = false,
    selectedOrg,
    checkLoading = false,
    onSuccess,
    // 是否需要调用发布校验接口（只有从组织管理、数字员工管理打开的使用权限授权弹窗才需要）
    needCheckPublish = false,
    pid, // 开发态：项目ID
    authApiPath, // 授权接口路径
  } = props;
  const intl = useIntl();
  const dispatch = useDispatch();
  // console.log('authApiPath', authApiPath);
  const { redList, blackList, setRedList, setBlackList, setAuth, detailLoading, authLoading } = useAuth({
    authType,
    grantObjType: record?.resourceBizType,
    grantObjId: record?.resourceId || record?.id || record?.resourceIdStr,
    orgId: selectedOrg?.orgId,
    pid,
    authApiPath,
  });

  // 执行授权操作
  const executeAuth = useCallback(() => {
    setAuth(() => {
      onSuccess?.();
      onCancel?.();
    });
  }, [setAuth, onSuccess, onCancel]);
  // 处理确定按钮点击
  const handleOk = useCallback(() => {
    // 只有从组织管理、数字员工管理打开的使用权限授权弹窗才需要调用校验接口
    if (!needCheckPublish) {
      // 不需要校验，直接执行授权
      executeAuth();
      return;
    }
    // 获取 resourceId
    console.log('record', record);
    const checkResourceId = record?.resourceId || record?.id || '';
    if (!checkResourceId) {
      message.error('缺少 resourceId 参数');
      return;
    }

    // 从授权列表中提取组织ID和用户ID
    // redList 中包含授权对象，可能是组织或用户
    const manOrgIdList = [];
    const userIdList = [];

    // 从 redList 中提取组织ID和用户ID
    if (redList && Array.isArray(redList)) {
      redList.forEach((item) => {
        // 从 id 中提取 grantToObjId（格式：type_grantToObjId）
        const grantToObjId = item.id?.split('_')[1] || item.grantToObjId;
        if (!grantToObjId) return;

        if (item.type === 'ORG') {
          // 如果是组织，提取组织ID
          if (!manOrgIdList.includes(String(grantToObjId))) {
            manOrgIdList.push(String(grantToObjId));
          }
        } else if (item.type === 'USER') {
          // 如果是用户，提取用户ID
          if (!userIdList.includes(String(grantToObjId))) {
            userIdList.push(String(grantToObjId));
          }
        }
      });
    }

    // 先调用校验接口
    dispatch({
      type: 'employeeMgr/checkDigitalEmployeePublish',
      payload: {
        resourceId: Number(checkResourceId),
        type: 'handleAuth',
        manOrgIdList: manOrgIdList.length > 0 ? manOrgIdList : undefined,
        userIdList: userIdList.length > 0 ? userIdList : undefined,
      },
      success: (response) => {
        // 当 code=0 并且 data=null 时，直接执行下一步操作
        if (!response.data || response.data === null) {
          executeAuth();
          return;
        }

        // 当 code=0 并且 data 里面的 compliance 都为 true 时，直接执行下一步操作
        const dataList = Array.isArray(response.data) ? response.data : [];
        const allCompliant = dataList.every((item) => item.compliance === true);
        if (allCompliant) {
          executeAuth();
          return;
        }

        // 当 code=0 并且 data 里面的 compliance 有为 false 时，弹出 confirm
        const unpassedItems = dataList.filter((item) => item.compliance === false);
        if (unpassedItems.length > 0) {
          showPublishConfirm(unpassedItems, '授权').then((confirmed) => {
            if (confirmed) {
              // 用户点击"继续授权"
              executeAuth();
            }
            // 用户点击"取消"，不执行任何操作
          });
        } else {
          // 如果没有不通过的项，直接执行授权
          executeAuth();
        }
      },
      fail: () => {
        // 校验接口调用失败，不执行授权操作
      },
    });
  }, [dispatch, record, executeAuth, needCheckPublish, redList]);

  return (
    <ModalDrawer
      title={
        authType === 'useAuth'
          ? intl.formatMessage({ id: 'auth.usePermission' })
          : intl.formatMessage({ id: 'auth.managePermission' })
      }
      onCancel={onCancel}
      open
      onOk={handleOk}
      confirmLoading={authLoading || checkLoading}
    >
      <div className={`${styles.headWrap} ub ub-ac gap8`}>
        {icon || <span className="iconHead mr-8" />}
        <div className="ub-f1">
          <div className="bold ellipsis">{title || intl.formatMessage({ id: 'auth.defaultDocLib' })}</div>
          <div className={`${styles.tips} ellipsis`} title={content}>
            {content || intl.formatMessage({ id: 'auth.defaultDocDesc' })}
          </div>
        </div>
      </div>
      <Row className={styles.selectionWrap} gutter={16}>
        <Col span={24}>
          <Spin spinning={detailLoading}>
            <AuthList
              data={redList}
              setData={setRedList}
              titleRowRender={(count) => (
                <span className={styles.selectTitle}>
                  {intl.formatMessage({ id: 'auth.authObjects' })} {count}{' '}
                  <span>({intl.formatMessage({ id: 'auth.including' })})</span>
                </span>
              )}
              modelRender={(modelPorps) => (
                <AddAuthModal
                  title={intl.formatMessage({ id: 'auth.addAuthObject' })}
                  onlyUser={onlyUser}
                  showPost={showPost}
                  showStation={showStation}
                  {...modelPorps}
                />
              )}
              btnRender={intl.formatMessage({ id: 'common.add' })}
              onlyView={onlyView}
            />
          </Spin>
        </Col>
      </Row>
      {showBlack && (
        <Row className={styles.selectionWrap} gutter={16} style={{ marginTop: 16 }}>
          <Col span={24}>
            <Spin spinning={detailLoading}>
              <AuthList
                data={blackList}
                setData={setBlackList}
                titleRowRender={(count) => (
                  <span className={styles.selectTitle}>
                    {intl.formatMessage({ id: 'auth.excludeObjects' })} {count}{' '}
                    <span>({intl.formatMessage({ id: 'auth.excluding' })})</span>
                  </span>
                )}
                modelRender={(modelPorps) => (
                  <AddAuthModal
                    title={intl.formatMessage({ id: 'auth.addExcludeObject' })}
                    onlyUser={onlyUser}
                    showPost={showPost}
                    showStation={showStation}
                    {...modelPorps}
                  />
                )}
                btnRender={intl.formatMessage({ id: 'common.add' })}
                onlyView={onlyView}
              />
            </Spin>
          </Col>
        </Row>
      )}
    </ModalDrawer>
  );
};

export default connect(({ loading }) => ({
  checkLoading: loading.effects['employeeMgr/checkDigitalEmployeePublish'],
}))(AuthListDrawer);
