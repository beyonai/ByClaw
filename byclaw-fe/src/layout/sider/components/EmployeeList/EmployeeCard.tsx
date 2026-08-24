import React, { useCallback, useEffect, useRef, useState, useContext } from 'react';
import { debounce, noop, isEmpty } from 'lodash';

// @ts-ignore
import { useNavigate, useIntl, useDispatch } from '@umijs/max';
import { List, Skeleton, Typography, Dropdown, Popconfirm, message } from 'antd';
import classNames from 'classnames';
import { isTopAgent, setDefaultDigitalEmployee } from '@/service/digitalEmployees';
import AntdIcon from '@/components/AntdIcon';
import useGlobal from '@/hooks/useGlobal';
import { IAgentCache } from '@/typescript/agent';
import { agentHandler, getAgentChatAvatar } from '@/utils/agent';
import EmployeesDrawer from '@/pages/employees/components/EmployeesDrawer';
import { UnApplyButton } from '@/pages/digitalEmployees/components/AllDigitalEmployees/RenderRightBottom';
import { ResourceTypeMap } from '@/constants/resource';
import useTracker from '@/hooks/useTracker';
import { EmployeeListContext, isInputMode } from './index';

import styles from './index.module.less';
import { isOpenClawAgent } from '@/utils/openClaw/utils';

const { Title, Paragraph } = Typography;

interface EmployeeCardProps extends React.HTMLAttributes<HTMLDivElement> {
  employee: IAgentCache;
  onSelect: (employee: any) => void;
  renderActionIcon?: (employee: IAgentCache) => React.ReactNode;
  disabledAction?: string[];
}

const EmployeeCard: React.FC<EmployeeCardProps> = ({
  employee,
  onSelect,
  renderActionIcon,
  disabledAction = [],
  ...rest
}) => {
  const { trackerEmployeeClick } = useTracker();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const { chatMode } = useContext(EmployeeListContext);
  const { setAgentId, setSessionId, EventEmitter } = useGlobal();

  const listItemRef = useRef<HTMLDivElement>(null);

  const [canShow, setCanShow] = useState<boolean>(false);
  const [isUnApplyLoading, setIsUnApplyLoading] = useState<boolean>(false);
  const [settingDefault, setSettingDefault] = useState<boolean>(false);
  const intl = useIntl();

  const isInput = isInputMode(chatMode);
  const shouldShowTag = employee?.tagName || employee?.isDefault;
  const defaultTagText = intl.formatMessage({ id: 'resource.defaultDigitalEmployee' });

  const menuItems = (item: IAgentCache) => {
    const items = [];

    // 设为默认
    if (item.canSetDefault && !disabledAction.includes('setDefault')) {
      items.push({
        key: 'setDefault',
        label: (
          <Popconfirm
            title={intl.formatMessage({ id: 'resource.setDefaultAssistantConfirm' })}
            okText={intl.formatMessage({ id: 'common.confirm' })}
            cancelText={intl.formatMessage({ id: 'common.cancel' })}
            onConfirm={(e) => {
              e?.stopPropagation();
              const resourceId = item.resourceId ?? item.id ?? item.agentId;
              if (!resourceId) return;

              setSettingDefault(true);
              setDefaultDigitalEmployee({ resourceId })
                .then((data) => {
                  message.success(intl.formatMessage({ id: 'resource.setDefaultAssistantSuccess' }));
                  const newDefaultId = data?.newResourceId ?? resourceId;

                  dispatch({
                    type: 'employees/save',
                    payload: { defaultDigEmployeeId: newDefaultId },
                  });
                  EventEmitter.emit('beyond-update-employee', {
                    defaultResourceId: newDefaultId,
                  });
                  EventEmitter.emit('default-digital-employee-changed', {
                    defaultResourceId: newDefaultId,
                  });
                })
                .catch((error: any) => {
                  message.error(error?.message || error || intl.formatMessage({ id: 'common.operationFailed' }));
                })
                .finally(() => {
                  setSettingDefault(false);
                });
            }}
          >
            <div className={classNames(styles.dropdownMenuItem, { [styles.dropdownMenuItemDisabled]: settingDefault })}>
              <AntdIcon type="icon-a-Useryonghu" style={{ marginRight: '10px' }} />
              {intl.formatMessage({ id: 'resource.setDefaultAssistant' })}
            </div>
          </Popconfirm>
        ),
      });
    }

    // 置顶
    if (`${item.isTop}` === '0' && !disabledAction.includes('pin')) {
      items.push({
        key: 'pin',
        label: (
          <div className={styles.dropdownMenuItem}>
            <AntdIcon type="icon-zhiding" style={{ marginRight: '10px' }} />
            {intl.formatMessage({ id: 'common.pin' })}
          </div>
        ),
      });
    }

    // 取消置顶
    if (`${item.isTop}` === '1' && !disabledAction.includes('unpin')) {
      items.push({
        key: 'unpin',
        label: (
          <div className={styles.dropdownMenuItem}>
            <AntdIcon type="icon-quxiaozhiding" style={{ marginRight: '10px' }} />
            {intl.formatMessage({ id: 'common.unpin' })}
          </div>
        ),
      });
    }

    // 移除
    if (item.grantType === 'AVAILABLE_USE' && !disabledAction.includes('unapply')) {
      items.push({
        key: 'unapply',
        label: (
          <UnApplyButton employee={item} isLoading={isUnApplyLoading} setIsLoading={setIsUnApplyLoading}>
            <div className={styles.dropdownMenuItem}>
              <AntdIcon type="icon-quxiaodingyue" style={{ marginRight: '10px' }} />
              {intl.formatMessage({ id: 'digitalEmployees.unapply' })}
            </div>
          </UnApplyButton>
        ),
      });
    }

    return items;
  };

  const items = menuItems(employee);

  useEffect(() => {
    if (!listItemRef.current || canShow) return noop;

    let observer: any;

    const callback = debounce((entries) => {
      entries.forEach((entry: any) => {
        if (entry.intersectionRatio > 0) {
          // 元素进入可视区域
          setCanShow(true);
          observer?.disconnect();
        } else {
          // 元素离开可视区域
        }
      });
    }, 300);

    observer = new IntersectionObserver(callback);
    observer.observe(listItemRef.current);
    return () => {
      observer.disconnect();
    };
  }, [employee, canShow]);

  const onClickEmployee = useCallback(
    debounce((employee: IAgentCache) => {
      trackerEmployeeClick(employee, 'siderAgentRedirect');

      // 左侧列表接口字段并不完全一致，进入详情前统一补齐 name、agentId 等详情页依赖字段。
      const normalizedEmployee = agentHandler(employee);
      const targetAgentId =
        normalizedEmployee.agentId ||
        normalizedEmployee.resourceCode ||
        normalizedEmployee.resourceId ||
        normalizedEmployee.id;
      if (!targetAgentId) return;
      dispatch({
        type: 'employees/updateEmployee',
        payload: { employee: normalizedEmployee },
      });
      setAgentId?.(`${targetAgentId}`);
      setSessionId?.('');
      // 员工模块内统一打开员工详情，避免按员工类型分流到会话、沙箱等其他页面。
      navigate('/employees', {
        state: {
          keepSiderActiveKey: 'agent',
          selectedAgentId: `${targetAgentId}`,
          selectedEmployee: normalizedEmployee,
        },
      });
    }, 300),
    [dispatch, navigate, setAgentId, setSessionId, trackerEmployeeClick]
  );

  const TagRender = useCallback((item: IAgentCache) => {
    if (item?.isDefault) {
      return (
        <span className={classNames(styles.defaultTag)}>
          <span className={styles.tagText}>{defaultTagText}</span>
        </span>
      );
    }

    if (item?.ownerType === 'personal' || item?.ownerType === 'personal_default') {
      return (
        <span className={classNames(styles.personalTag)}>
          <span className={styles.tagText}>{item?.tagName}</span>
        </span>
      );
    }

    return (
      <span className={styles.tag}>
        <span className={styles.tagText}>{item?.tagName}</span>
      </span>
    );
  }, []);

  return (
    <List.Item
      {...rest}
      ref={listItemRef}
      key={employee.agentId}
      className={classNames({
        pointer: true,
      })}
      onClick={() => {
        if (isInput) {
          onSelect?.(employee);
          return;
        }

        if (isOpenClawAgent(employee)) {
          onClickEmployee(employee);
          return;
        }
        if (employee?.integrationType === 'PAGE') {
          onClickEmployee(employee);
          return;
        }

        onClickEmployee(employee);
      }}
      actions={[
        renderActionIcon?.(employee) ?? null,
        isEmpty(items) ? null : (
          <Dropdown
            key={employee.agentId}
            menu={{
              items,
              onClick: ({ key, domEvent }) => {
                domEvent.preventDefault();
                domEvent.stopPropagation();

                if (key === 'setDefault') {
                  return;
                }

                if (key === 'pin' || key === 'unpin') {
                  isTopAgent({
                    agentIds: [employee.id],
                    isTop: key === 'pin' ? 1 : 0,
                    agentTypeList: [ResourceTypeMap.digitalEmployee],
                  }).then(() => {
                    if (key === 'pin') {
                      EventEmitter.emit('beyond-update-employee', { pinList: [employee.agentId] });
                    } else {
                      EventEmitter.emit('beyond-update-employee', { unpinList: [employee.agentId] });
                    }
                  });
                }
              },
            }}
            overlayClassName={styles.mydropdown}
          >
            {/* 一定要有父节点包着AntdIcon，否则会死循环更新页面全屏报错 */}
            <span
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
            >
              <AntdIcon type="icon-a-Moregengduo" />
            </span>
          </Dropdown>
        ),
      ].filter(Boolean)}
    >
      {!canShow && <Skeleton avatar={{ size: 'default' }} paragraph={{ rows: 1 }} />}
      {canShow && (
        <List.Item.Meta
          avatar={
            isInput ? (
              <EmployeesDrawer agentInfo={employee}>
                <div style={{ height: '32px', width: '32px' }}>{getAgentChatAvatar(employee?.chatAvatar)}</div>
              </EmployeesDrawer>
            ) : (
              <div style={{ height: '32px', width: '32px' }}>{getAgentChatAvatar(employee?.chatAvatar)}</div>
            )
          }
          title={
            <Title className={styles.name}>
              <span className={classNames(styles.nameRow)}>
                <span className={classNames(styles.nameText)}>
                  {employee?.resourceName || employee?.name || employee?.id || ''}
                </span>
                {shouldShowTag && TagRender(employee)}
              </span>
            </Title>
          }
          description={
            <div className="ub ub-ac ub-pj gap4">
              <Paragraph
                className={classNames(styles.description, 'ub-f1')}
                ellipsis={{ tooltip: { title: employee?.resourceDesc, placement: 'right' } }}
              >
                {employee?.resourceDesc}
              </Paragraph>
              {`${employee?.isTop}` === '1' && <AntdIcon type="icon-zhiding-fill" className={styles.pinBadge} />}
            </div>
          }
        />
      )}
    </List.Item>
  );
};

export default React.memo(EmployeeCard);
