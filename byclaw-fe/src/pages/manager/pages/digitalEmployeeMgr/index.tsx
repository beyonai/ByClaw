// @ts-nocheck
/* eslint-disable no-empty */

import React, { useCallback, useState, useEffect, useMemo } from 'react';
import { KeepAlive, useActivate } from 'react-activation';

import { Button, Input, Avatar, Space, Popconfirm, message, Modal, Spin, Tooltip } from 'antd';
import classNames from 'classnames';
import { useSelector, history, useDispatch, useIntl } from '@umijs/max';
import dayjs from 'dayjs';
import { trim, uniqBy, head, get } from 'lodash';

import CardList from '@/pages/manager/components/CardList';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import commonStyles from '@/pages/manager/styles/commonTabList.less';
import EmployFormModal from './components/EmployFormModal';
import useShowModal from '@/pages/manager/hooks/useShowModal';
import { Image } from '@/pages/manager/components/Image';
import styles from './index.module.less';
import AuthListDrawer from '@/pages/manager/components/AuthListDrawer';
import PublishModal from './components/PublishModal';
import EmployeesDrawer from './components/EmployeesDrawer';
import { queryStatus } from '@/pages/manager/constants/digitalResource';
import TreeFilter from '@/pages/manager/components/TreeFilter';
import FieldFilter from '@/pages/manager/components/TreeFilter/FieldFilter';
// import SourceFilter from '@/pages/manager/components/TreeFilter/SourceFilter';
import { getAvatarUrl } from '@/pages/manager/utils/agent';
import UseApplyAuditDrawer from '@/pages/manager/components/UseApplyAuditDrawer';
import { applyResourceUse, queryResourceOperationPermissions } from '@/pages/manager/service/resources';

const initPagination = {
  pageIndex: 1,
  pageSize: 12,
  total: 0,
};

const sourceTypes = ['DIG_EMPLOYEE'];

const getListType = (activeKey) => {
  if (activeKey === 'create') return 'owner';
  if (activeKey === 'manage') return 'manager';
  return '';
};

const initResultData = () => {
  return {
    list: [],
    pagination: {
      ...initPagination,
    },
  };
};

const DigitalEmployeeMgr = () => {
  const intl = useIntl();
  const dispatch = useDispatch();
  const { isLoading, pushLoading, unPushLoading } = useSelector(({ loading }) => ({
    isLoading: loading.effects['employeeMgr/selectDigitalEmployeeByQo'],
    // pushLoading: loading.effects['resourceMgr/shelfResource'],
    // unPushLoading: loading.effects['resourceMgr/unShelfResource'],
  }));

  const { actionLoading } = useSelector(({ loading }) => ({
    actionLoading:
      loading.effects['employeeMgr/rollbackVersion'] ||
      loading.effects['employeeMgr/deleteResource'] ||
      loading.effects['employeeMgr/getCompositeAppInfo'] ||
      loading.effects['employeeMgr/approveTask'] ||
      loading.effects['employeeMgr/cancelCheck'],
  }));

  const { systemConfig, userInfo } = useSelector(({ session }) => ({
    systemConfig: session.systemConfig,
    userInfo: session.userInfo,
  }));

  const { ENABLE_APPROVE } = systemConfig || {};
  const { userId, userCode } = userInfo || {};

  const typeOptions = useMemo(
    () => [
      {
        label: intl.formatMessage({ id: 'digitalEmployeeMgr.tabs.all' }),
        key: 'all',
        keypath: 'all',
      },
      {
        label: intl.formatMessage({ id: 'digitalEmployeeMgr.tabs.create' }),
        key: 'create',
        keypath: 'create',
      },
      {
        label: intl.formatMessage({ id: 'digitalEmployeeMgr.tabs.manage' }),
        key: 'manage',
        keypath: 'manage',
      },
    ],
    [intl]
  );

  const [typeActiveKey, setTypeActiveKey] = useState([head(typeOptions)]);
  const [activeType, setActiveType] = useState(-1);
  const [selectRecord, setSelectRecord] = useState();
  const [authType, setAuthType] = useState();
  const [useApplyAuditOpen, setUseApplyAuditOpen] = useState(false);
  const [resultData, setResultData] = useState(initResultData());
  const [operationPermissionMap, setOperationPermissionMap] = useState({});
  const [searchValue, setSearchValue] = useState('');
  const [appliedSearchValue, setAppliedSearchValue] = useState('');

  const [modalState, modalAction] = useShowModal();
  const [publishState, publishAction] = useShowModal();
  const [drawerState, drawerAction] = useShowModal();
  const [employeeState, employeeAction] = useShowModal();
  const [approvalTaskState, approvalTaskAction] = useShowModal();

  const { list = [], pagination } = resultData;

  const [queryStatusConstList, setQueryStatusConstList] = useState([]);
  const [approvalTaskContent, setApprovalTaskContent] = useState('');
  const [approvalTaskLoading, setApprovalTaskLoading] = useState(false);

  const [fieldSelect, setFieldSelect] = useState([]);
  const [sourceSelect, setSourceSelect] = useState([]);
  const sourceValue = React.useMemo(() => {
    return sourceSelect.map((i) => i.key);
  }, [sourceSelect]);

  const fieldValue = React.useMemo(() => {
    return fieldSelect.map((i) => i.key);
  }, [fieldSelect]);

  const activeKey = React.useMemo(() => {
    return get(head(typeActiveKey), 'key');
  }, [typeActiveKey]);

  const allStatusList = useMemo(() => {
    if (`${ENABLE_APPROVE}` === 'false') {
      return [0, 2, 3];
    }

    return [0, 2, 3, 4, 5];
  }, [ENABLE_APPROVE]);

  const getOwnershipType = (activeKey) => {
    if (activeKey === 'create') {
      return 1;
    }
    if (activeKey === 'manage') {
      return 2;
    }

    return 0;
  };

  const getList = useCallback(
    (params) => {
      dispatch({
        type: 'employeeMgr/selectDigitalEmployeeByQo',
        payload: {
          pageNum: params?.pageNum ?? initPagination.pageIndex,
          pageSize: params?.pageSize ?? initPagination.pageSize,
          keyword: params?.keyword ?? appliedSearchValue,
          type: getListType(activeKey),
          resourceStatus: activeType === -1 ? undefined : activeType,
          systemCodes: sourceValue,
          catalogIds: fieldValue,
          statusList: activeType === -1 ? allStatusList : [activeType],
          ownershipType: getOwnershipType(activeKey),
          ...params,
        },
        success: (res) => {
          const { list = [], rows = [], pageNum: newPageIndex, pageSize, total } = res || {};
          const dataList = list?.length ? list : rows;
          setResultData({
            list: uniqBy(dataList || [], 'resourceId'),
            pagination: { pageIndex: newPageIndex, pageSize, total },
          });
        },
      });
    },
    [dispatch, activeKey, activeType, appliedSearchValue, sourceValue, fieldValue, allStatusList]
  );

  const getNum = useCallback(
    (keyword = appliedSearchValue) => {
      const key = activeKey;

      dispatch({
        type: 'employeeMgr/getStatusNumStatics',
        payload: {
          ownershipType: getOwnershipType(activeKey),
          resourceTypeList: ['DIG_EMPLOYEE'],
          resourceName: keyword,
          systemCodes: sourceValue,
          catalogIds: fieldValue,
        },
        success: (res) => {
          if (key !== activeKey) {
            console.warn('key !== activeKey', key, activeKey);
            return;
          }
          const map = {
            '-1': 'ALL',
            0: 'DRAFT',
            1: 'PENDING',
            2: 'SHELF',
            3: 'UNSHELF',
            4: 'AUDIT',
            5: 'AUDIT_REJECT',
          };
          setQueryStatusConstList(
            queryStatus
              ?.filter((ele) => {
                if (`${ENABLE_APPROVE}` === 'false' && [4, 5].includes(ele.value)) {
                  return false;
                }
                return true;
              })
              ?.map((ele) => ({
                ...ele,
                count: res[map[ele.value]],
              }))
          );
        },
      });
    },
    [dispatch, activeKey, appliedSearchValue, ENABLE_APPROVE, sourceValue, fieldValue]
  );

  useEffect(() => {
    getNum();
    getList({
      pageNum: 1,
      pageSize: pagination.pageSize,
      keyword: appliedSearchValue,
    });
  }, [activeKey, activeType, sourceValue, fieldValue, appliedSearchValue, getList, getNum, pagination.pageSize]);

  useEffect(() => {
    if (!list.length) {
      return undefined;
    }

    let cancelled = false;
    const resourceIds = list.map((item) => item?.resourceId).filter(Boolean);

    // 旧数字员工管理页也统一复用后端操作权限口径，避免前端本地判断和资源中心卡片分叉。
    Promise.all(
      resourceIds.map(async (resourceId) => {
        try {
          const res = await queryResourceOperationPermissions({ resourceId });
          return [resourceId, res?.data || res];
        } catch {
          return [resourceId, null];
        }
      })
    ).then((entries) => {
      if (cancelled) {
        return;
      }
      setOperationPermissionMap((prev) => {
        const next = { ...prev };
        entries.forEach(([resourceId, permissions]) => {
          next[resourceId] = permissions;
        });
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [list]);

  const onSearch = useCallback(
    (params = {}) => {
      const shouldUseAppliedKeyword = params?.pageNum !== undefined || params?.pageSize !== undefined;
      const keyword = trim(params?.keyword ?? (shouldUseAppliedKeyword ? appliedSearchValue : searchValue));
      const pageNum = params?.pageNum ?? 1;
      const pageSize = params?.pageSize ?? pagination.pageSize;

      if (keyword !== appliedSearchValue) {
        setAppliedSearchValue(keyword);
        return;
      }

      if (pageNum === 1) {
        getNum(keyword);
      }
      getList({ pageNum, pageSize, keyword, ...params });
    },
    [appliedSearchValue, getList, getNum, pagination.pageSize, searchValue]
  );

  const refreshCurrentView = useCallback(() => {
    onSearch({
      pageNum: pagination.pageIndex,
      pageSize: pagination.pageSize,
      keyword: appliedSearchValue,
    });
  }, [appliedSearchValue, onSearch, pagination.pageIndex, pagination.pageSize]);

  const getActionList = useCallback(
    (record) => {
      const {
        createType,
        // resourceIdStr,
        resourceId,
        // rollback,
        // resourceStatus, // 0-草稿 1-待发布 2-上架 3-下架 4-审核中 5-审核不通过
        _authStatus, // eslint-disable-line @typescript-eslint/no-unused-vars
        // manUserId, // 审批者id
        // createBy, // 创建者id
        // taskId,
        // approvalContent,
        // manPrivIds,
      } = record;
      // 操作按钮统一以后端权限接口为准，避免旧页面继续按本地条件展示不该出现的授权/申请/审核按钮。
      const operationPermissions = operationPermissionMap[resourceId];
      // const isCreator = `${createBy}` === `${userId}`;
      // const isManager = (manPrivIds || '').includes(`${userId}`);
      // const isApprover = `${manUserId}` === `${userId}` || `${userCode}` === 'adminvip' || isManager;

      const actionList = [];
      const edit = {
        type: 'edit',
        name: intl.formatMessage({ id: 'common.edit' }),
        onClick: () => {
          try {
            sessionStorage.setItem('EmployeeDetail_prevRoute', `${window.location.pathname}${window.location.search}`);
          } catch (e) {}
          history.push(`/manager/resource/employeeDetail?digitalType=${createType || ''}&appId=${resourceId}`);
        },
      };

      // const rollbackBtn = {
      //   type: 'rollback',
      //   name: intl.formatMessage({ id: 'resourceAction.rollback' }),
      //   onClick: () => {
      //     dispatch({
      //       type: 'employeeMgr/rollbackVersion',
      //       payload: {
      //         resourceId,
      //       },
      //       success: () => {
      //         message.success(
      //           intl.formatMessage({
      //             id: 'resourceAction.rollbackSuccess',
      //           })
      //         );
      //         getList();
      //       },
      //     });
      //   },
      // };

      const del = {
        type: 'del',
        name: intl.formatMessage({ id: 'common.delete' }),
        onClick: () => {
          dispatch({
            type: 'employeeMgr/deleteResource',
            payload: {
              resourceIds: [resourceId],
            },
            success: () => {
              message.success(
                intl.formatMessage({
                  id: 'common.deleteSuccess',
                })
              );
              refreshCurrentView();
            },
          });
        },
      };
      // const online = {
      //   type: 'online',
      //   name: intl.formatMessage({ id: 'resourceAction.push' }),
      //   onClick: () => {
      //     if (pushLoading) {
      //       message.warning(
      //         intl.formatMessage({
      //           id: 'resourceAction.operationFrequent',
      //         })
      //       );
      //       return;
      //     }
      //     dispatch({
      //       type: 'resourceMgr/shelfResource',
      //       payload: {
      //         resourceIds: [resourceIdStr],
      //       },
      //       success: () => {
      //         message.success(
      //           intl.formatMessage({
      //             id: 'resourceAction.pushSuccess',
      //           })
      //         );
      //         getList();
      //         getNum();
      //       },
      //     });
      //   },
      // };

      // const offline = {
      //   type: 'offline',
      //   name: intl.formatMessage({ id: 'resourceAction.unPush' }),
      //   onClick: () => {
      //     if (unPushLoading) {
      //       message.warning(
      //         intl.formatMessage({
      //           id: 'resourceAction.operationFrequent',
      //         })
      //       );
      //       return;
      //     }
      //     dispatch({
      //       type: 'resourceMgr/unShelfResource',
      //       payload: {
      //         resourceIds: [resourceIdStr],
      //       },
      //       success: () => {
      //         message.success(
      //           intl.formatMessage({
      //             id: 'resourceAction.unPushSuccess',
      //           })
      //         );
      //         getList();
      //       },
      //     });
      //   },
      // };

      const auth = {
        type: 'useAuth',
        name: intl.formatMessage({ id: 'resourceAction.useAuth' }),
        onClick: () => {
          drawerAction.handleShow('edit');
          setSelectRecord(record);
          setAuthType('useAuth');
        },
      };

      const manageAuth = {
        type: 'manageAuth',
        name: intl.formatMessage({ id: 'common.manageAuthorization' }),
        onClick: () => {
          drawerAction.handleShow('edit');
          setSelectRecord(record);
          setAuthType('mgrAuth');
        },
      };

      const applyUse = {
        type: 'applyUse',
        name: intl.formatMessage({ id: 'resource.applyUse' }),
        onClick: async () => {
          await applyResourceUse({ resourceId });
          message.success(intl.formatMessage({ id: 'resource.applyUseSuccess' }));
          refreshCurrentView();
        },
      };

      const auditUse = {
        type: 'auditUse',
        name: intl.formatMessage({ id: 'resource.auditUse' }),
        onClick: () => {
          setSelectRecord(record);
          setUseApplyAuditOpen(true);
        },
      };

      // const publish = {
      //   type: 'publish',
      //   name: intl.formatMessage({ id: 'common.publish' }),
      //   onClick: () => {
      //     dispatch({
      //       type: 'employeeMgr/getCompositeAppInfo',
      //       payload: { resourceId: record.resourceId },
      //       success: (res) => {
      //         publishAction.handleShow('add', res);
      //       },
      //     });
      //   },
      // };

      // 撤回
      // const withdraw = {
      //   type: 'withdraw',
      //   name: intl.formatMessage({ id: 'common.withdraw' }),
      //   onClick: () => {
      //     dispatch({
      //       type: 'employeeMgr/cancelCheck',
      //       payload: { resourceId: record.resourceId },
      //       success: () => {
      //         getList();
      //         getNum();
      //       },
      //     });
      //   },
      // };

      // 审核通过
      // const pass = {
      //   type: 'pass',
      //   name: intl.formatMessage({ id: 'digitalEmployeeMgr.approve.pass' }),
      //   onClick: () => {
      //     dispatch({
      //       type: 'employeeMgr/approveTask',
      //       payload: {
      //         taskId,
      //         approvalStatus: 'PASS', //PASS通过,REJECT-不通过
      //       },
      //       success: () => {
      //         getList();
      //         getNum();
      //       },
      //     });
      //   },
      // };

      // 审核不通过
      // const notPass = {
      //   type: 'notPass',
      //   name: intl.formatMessage({ id: 'digitalEmployeeMgr.approve.reject' }),
      //   onClick: () => {
      //     setApprovalTaskContent('');
      //     setApprovalTaskLoading(false);
      //     approvalTaskAction.handleShow('view', record);
      //   },
      // };

      // 审批意见
      // const opinion = {
      //   type: 'opinion',
      //   name: intl.formatMessage({ id: 'digitalEmployeeMgr.approve.opinion' }),
      //   onClick: () => {
      //     Modal.info({
      //       centered: true,
      //       title: intl.formatMessage({ id: 'digitalEmployeeMgr.approve.opinion' }),
      //       icon: null,
      //       content: approvalContent,
      //       bodyStyle: {
      //         padding: '12px',
      //       },
      //     });
      //   },
      // };

      // 权限未加载或接口失败时不展示操作按钮，防止出现“按钮可见但点击被后端拒绝”的交互闪烁。
      if (operationPermissions?.canEdit) {
        actionList.push(edit);
      }
      if (operationPermissions?.canManageAuth) {
        actionList.push(manageAuth);
      }
      if (operationPermissions?.canUseAuth) {
        actionList.push(auth);
      }
      if (operationPermissions?.canApplyUse) {
        actionList.push(applyUse);
      }
      if (operationPermissions?.canAuditUse) {
        actionList.push(auditUse);
      }
      if (operationPermissions?.canDelete) {
        actionList.push(del);
      }

      // 0-草稿
      // if (resourceStatus === 0) {
      //   actionList.push( del, publish);
      //   if (rollback) {
      //     actionList.push(rollbackBtn);
      //   }
      // }

      // 2-已上架
      // if (resourceStatus === 2) {
      //   actionList.push(auth);
      //   if (isApprover) {
      //     actionList.push(offline);
      //   }
      // }

      // // 3-已下架
      // if (resourceStatus === 3) {
      //   actionList.push( del);
      //   if (isApprover) {
      //     actionList.push(online);
      //   }
      // }

      // 4-审核中
      // if (resourceStatus === 4) {
      //   if (isCreator) {
      //     // 我创建，我审核的，能选择pass
      //     actionList.push(withdraw);
      //     if (isApprover) {
      //       actionList.push(pass);
      //     }
      //   }
      //   if (isApprover) {
      //     if (isCreator) {
      //       actionList.push(notPass);
      //     } else {
      //       actionList.push(pass, notPass);
      //     }
      //   }
      // }

      // // 5-审核不通过
      // if (resourceStatus === 5) {
      //   actionList.push(opinion);
      //   if (isCreator) {
      //     actionList.push( del);
      //   }
      // }

      return actionList;
    },
    [
      userCode,
      userId,
      activeKey,
      activeType,
      dispatch,
      pushLoading,
      unPushLoading,
      refreshCurrentView,
      ENABLE_APPROVE,
      intl,
      operationPermissionMap,
    ]
  );

  // 数字员工卡片内容
  const cardItemFn = useCallback(
    (record) => {
      const {
        resourceIdStr,
        resourceName,
        // resourceStatus,
        resourceDesc,
        updateTime,
        createTime,
        createUserName,
        _manUserId, // eslint-disable-line @typescript-eslint/no-unused-vars
        _manUserName, // eslint-disable-line @typescript-eslint/no-unused-vars
        avatar,
        // authStatus,
      } = record;

      const actionlist = getActionList(record);

      return (
        <div
          className={styles.cardItem}
          onClick={() => {
            employeeAction.handleShow('view', record);
          }}
        >
          <div className={styles.content}>
            <div className={styles.contentMain}>
              <Image
                width={40}
                height={40}
                src={getAvatarUrl(avatar)}
                defaultSrc={getAvatarUrl()}
                style={{ borderRadius: '50%', overflow: 'hidden' }}
              />

              <div className={styles.contentMes}>
                <div className={styles.contentHeader}>
                  <div className={classNames(styles.contentTitle, 'ellipsis')} title={resourceName}>
                    {resourceName}
                  </div>
                  {/* {resourceStatus === 0 && (
                    <Tag className={styles.draft}>{intl.formatMessage({ id: 'resourceStatus.draft' })}</Tag>
                  )}
                  {resourceStatus === 1 && authStatus !== 'notPassed' && (
                    <Tag color="warning">{intl.formatMessage({ id: 'resourceStatus.reviewing' })}</Tag>
                  )}
                  {resourceStatus === 1 && authStatus === 'notPassed' && (
                    <Tag color="error">{intl.formatMessage({ id: 'resourceStatus.notPassed' })}</Tag>
                  )}
                  {resourceStatus === 2 && (
                    <Tag color="success">{intl.formatMessage({ id: 'resourceStatus.published' })}</Tag>
                  )}
                  {resourceStatus === 3 && <Tag>{intl.formatMessage({ id: 'resourceStatus.unpublished' })}</Tag>}
                  {resourceStatus === 4 && (
                    <Tag>{intl.formatMessage({ id: 'digitalEmployeeMgr.status.pendingApproval' })}</Tag>
                  )}
                  {resourceStatus === 5 && (
                    <Tag color="error">{intl.formatMessage({ id: 'digitalEmployeeMgr.status.approvalRejected' })}</Tag>
                  )} */}
                </div>
                <div className={classNames(styles.descBox, 'textEllipsis2')} title={resourceDesc}>
                  {resourceDesc}
                </div>
                <div className={styles.infoBox}>
                  <div className="ub ub-ac gap-4">
                    <div className="ub ub-f1">
                      {intl.formatMessage({ id: 'digitalEmployeeMgr.card.version' })}
                      <span className="ellipsis ub-f1" title={record.resourceDVerid || '-'}>
                        {record.resourceDVerid || '-'}
                      </span>
                    </div>
                    <div className="ub ub-f1">
                      {intl.formatMessage({ id: 'digitalEmployeeMgr.card.sourceSystem' })}
                      <span className="ellipsis ub-f1" title={record.systemCode || '-'}>
                        {record.systemCode || '-'}
                      </span>
                    </div>
                  </div>
                  <div className="ub ub-ac">
                    <div className="ub ub-f1">
                      {intl.formatMessage({ id: 'digitalEmployeeMgr.card.manager' })}
                      <span className="ellipsis ub-f1" title={record.manPrivNames || record.manUserName || '-'}>
                        {record.manPrivNames || record.manUserName || '-'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className={styles.cardBottom}>
            <div className={styles.btnGroup}>
              {actionlist.map((item) => {
                if (['del', 'offline', 'rollback'].includes(item.type)) {
                  let t = intl.formatMessage({
                    id: 'common.delete',
                  });
                  if (item.type === 'offline') {
                    t = intl.formatMessage({
                      id: 'resourceAction.unPush',
                    });
                  }
                  if (item.type === 'rollback') {
                    t = intl.formatMessage({
                      id: 'resourceAction.rollback',
                    });
                  }

                  return (
                    <Tooltip key={`${resourceIdStr}_${item.type}`} title={item.disabled ? item.disabledTip : undefined}>
                      <span>
                        {item.disabled ? (
                          <Button
                            className={styles.button}
                            type="link"
                            danger
                            disabled
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                            }}
                          >
                            {item.name}
                          </Button>
                        ) : (
                          <Popconfirm
                            title={intl.formatMessage(
                              {
                                id: 'digitalEmployeeAction.confirm',
                              },
                              { action: t }
                            )}
                            onConfirm={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              item.onClick();
                            }}
                            onCancel={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                            }}
                          >
                            <Button
                              className={styles.button}
                              type="link"
                              danger
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                              }}
                            >
                              {item.name}
                            </Button>
                          </Popconfirm>
                        )}
                      </span>
                    </Tooltip>
                  );
                }
                return (
                  <Tooltip key={`${resourceIdStr}_${item.type}`} title={item.disabled ? item.disabledTip : undefined}>
                    <span>
                      <Button
                        type="link"
                        disabled={item.disabled}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          if (item.disabled) {
                            return;
                          }
                          item.onClick();
                        }}
                        className={styles.button}
                      >
                        {item.name}
                      </Button>
                    </span>
                  </Tooltip>
                );
              })}
            </div>
            <div className={styles.cardInfo}>
              <div className={classNames(styles.createTime, 'ub ub-f1 ub-ac')}>
                <span>{intl.formatMessage({ id: 'digitalEmployeeMgr.latestEdited' })}&nbsp;</span>
                <span className="ellipsis ub-f1">
                  {updateTime || createTime ? dayjs(updateTime || createTime).format('YYYY-MM-DD HH:mm') : null}
                </span>
              </div>
              <div className={classNames(styles.userBox, 'ub ub-f1 ub-ac ub-pe')}>
                <div className="ub" style={{ maxWidth: '100%' }}>
                  <span>{intl.formatMessage({ id: 'digitalEmployeeMgr.card.creator' })}</span>
                  <span className="ellipsis ub-f1" title={createUserName || '-'}>
                    {createUserName || '-'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    },
    [getActionList, activeKey, activeType, intl]
  );

  useActivate(() => {
    onSearch({ keyword: appliedSearchValue });
  });

  React.useEffect(() => {
    setSourceSelect([]);
  }, [sourceTypes]);

  return (
    <div className={`${styles.digitEmployeeMgr} ${commonStyles.commonTabList}`}>
      <Spin spinning={!!actionLoading} wrapperClassName={styles.spinWrapper}>
        <div className={classNames(commonStyles.tabContent, 'minH0')}>
          <div className={commonStyles.tabHeader}>
            <Space>
              {queryStatusConstList.map((ele) => (
                <Button
                  key={ele.value}
                  type={activeType === ele.value ? 'primary' : 'default'}
                  onClick={() => {
                    setActiveType(ele.value);
                    setResultData(initResultData());
                  }}
                  style={{ fontSize: '13px' }}
                >
                  {ele.text}({ele.count || 0})
                </Button>
              ))}
            </Space>
          </div>
          <div className={styles.filter}>
            <>
              <TreeFilter
                title={intl.formatMessage({ id: 'digitalEmployeeMgr.filter.type' })}
                treeData={typeOptions}
                selectedList={typeActiveKey}
                onOk={(v) => {
                  setTypeActiveKey(v);
                  setActiveType(-1);
                  setResultData(initResultData());
                }}
                mode="radio"
              />
              <FieldFilter
                selectedList={fieldSelect}
                onOk={(v) => {
                  setSourceSelect([]);
                  setFieldSelect(v);
                }}
              />
              {/* <SourceFilter
                selectedList={sourceSelect}
                onOk={(v) => setSourceSelect(v)}
                catalogIds={fieldValue}
                sourceTypes={sourceTypes}
              /> */}
            </>
            <Space style={{ marginLeft: 'auto' }}>
              <Input
                suffix={
                  <AntdIcon
                    type="icon-a-Searchsousuo"
                    onClick={() => {
                      onSearch({ keyword: searchValue });
                    }}
                  />
                }
                placeholder={intl.formatMessage({
                  id: 'digitalEmployeeMgr.search.placeholder',
                })}
                className={commonStyles.searchInput}
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                onPressEnter={() => {
                  onSearch({ keyword: searchValue });
                }}
              />
              <Button
                type="primary"
                icon={<AntdIcon type="icon-a-People-plustianjiarenqun" />}
                className={styles.createBtn}
                onClick={() => modalAction.handleShow('add')}
              >
                {intl.formatMessage({ id: 'digitalEmployeeMgr.createEmployee' })}
              </Button>
            </Space>
          </div>
          <div className={classNames(styles.cardList, 'minH0')}>
            <CardList
              rowId="resourceIdStr"
              autoPageSize
              cardWidth={300}
              canSelect={false}
              dataSource={list}
              pagination={pagination}
              loading={isLoading}
              showPagination
              onPageChange={({ pageIndex, pageSize }) => {
                onSearch({ pageNum: pageIndex, pageSize });
              }}
              cardItemFn={cardItemFn}
            />
          </div>
        </div>
      </Spin>
      <EmployFormModal {...modalState} onCancel={modalAction.onCancel} reload={refreshCurrentView} />
      {publishState.open && (
        <PublishModal {...publishState} onCancel={publishAction.onCancel} reload={refreshCurrentView} />
      )}
      {drawerState.open && (
        <AuthListDrawer
          {...drawerState}
          onCancel={() => {
            drawerAction.onCancel();
          }}
          record={selectRecord}
          authType={authType}
          needCheckPublish={authType === 'useAuth'}
          authApiPath={`/byaiService/auth/privilegeGrant/${
            authType === 'useAuth' ? 'setResourceUsers' : 'setResourceManagers'
          }`}
          onSuccess={refreshCurrentView}
          headerInfo={{
            title: selectRecord.resourceName,
            content: selectRecord.resourceDesc,
            icon: (
              <Avatar
                size={32}
                src={
                  selectRecord?.avatar
                    ? `/byaiService${selectRecord.avatar}`
                    : `${_PUBLIC_PATH_}image/head/small/head5.png`
                }
                style={{ marginRight: 8 }}
              />
            ),
          }}
        />
      )}
      <UseApplyAuditDrawer
        open={useApplyAuditOpen}
        record={selectRecord}
        onCancel={() => {
          setUseApplyAuditOpen(false);
          setSelectRecord(null);
        }}
        onSuccess={refreshCurrentView}
      />
      {employeeState.open && (
        <EmployeesDrawer {...employeeState} onClose={employeeAction.onCancel} agentInfo={employeeState.data} />
      )}
      <Modal
        title={intl.formatMessage({ id: 'digitalEmployeeMgr.approve.opinion' })}
        open={approvalTaskState.open}
        onCancel={approvalTaskAction.onCancel}
        okButtonProps={{
          loading: approvalTaskLoading,
        }}
        onOk={() => {
          setApprovalTaskLoading(true);

          dispatch({
            type: 'employeeMgr/approveTask',
            payload: {
              taskId: approvalTaskState.data.taskId,
              approvalStatus: 'REJECT', //PASS通过,REJECT-不通过
              approvalContent: approvalTaskContent, //审批内容
            },
            success: () => {
              refreshCurrentView();
              setApprovalTaskLoading(false);
              approvalTaskAction.onCancel();
            },
            fail: () => {
              setApprovalTaskLoading(false);
            },
          });
        }}
      >
        <Input.TextArea
          placeholder={intl.formatMessage({ id: 'digitalEmployeeMgr.approve.opinionPlaceholder' })}
          rows={4}
          value={approvalTaskContent}
          onChange={(e) => {
            setApprovalTaskContent(trim(e.target.value));
          }}
        />
      </Modal>
    </div>
  );
};

export default () => {
  return (
    <KeepAlive
      cacheKey="DigitalEmployeeMgr"
      wrapperProps={{ style: { width: '100%', height: '100%' } }}
      contentProps={{ style: { width: '100%', height: '100%' } }}
      when={() => {
        // 当访问员工详情页或iframe页面时，缓存页面
        return window.location.pathname.includes('/manager/resource/employeeDetail');
      }}
    >
      <DigitalEmployeeMgr />
    </KeepAlive>
  );
};
