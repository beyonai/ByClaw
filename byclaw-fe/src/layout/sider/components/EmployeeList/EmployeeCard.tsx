import React, { useCallback, useEffect, useRef, useState, useContext } from 'react';
import { debounce, noop, isEmpty } from 'lodash';

// @ts-ignore
import { useNavigate, useIntl } from '@umijs/max';
import { List, Skeleton, Typography, Dropdown } from 'antd';
import classNames from 'classnames';
import { isTopAgent } from '@/service/digitalEmployees';
import AntdIcon from '@/components/AntdIcon';
import useGlobal from '@/hooks/useGlobal';
import { IAgentCache } from '@/typescript/agent';
import { getAgentChatAvatar, getAgentPath } from '@/utils/agent';
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

  const { chatMode } = useContext(EmployeeListContext);
  const { agentInfo, setAgentId, setSessionId, EventEmitter } = useGlobal();
  const { agentId } = agentInfo || {};

  const listItemRef = useRef<HTMLDivElement>(null);

  const [canShow, setCanShow] = useState<boolean>(false);
  const [isUnApplyLoading, setIsUnApplyLoading] = useState<boolean>(false);
  const intl = useIntl();

  const isInput = isInputMode(chatMode);

  const menuItems = (item: IAgentCache) => {
    const items = [];

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

    return items;
  };

  const items = React.useMemo(() => {
    return menuItems(employee);
  }, [employee]);

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

      setAgentId?.(`${employee.agentId}`);
      setSessionId?.('');
      navigate(getAgentPath(employee)); // 有可能问答报错
    }, 300),
    [agentId]
  );

  return (
    <List.Item
      {...rest}
      ref={listItemRef}
      key={employee.agentId}
      className={classNames({
        pointer: true,
      })}
      onClick={() => {
        if (isOpenClawAgent(employee)) {
          onClickEmployee(employee);
          return;
        }
        if (employee?.integrationType === 'PAGE') {
          onClickEmployee(employee);
          return;
        }

        if (isInput) {
          onSelect?.(employee);
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
                <span className={classNames(styles.nameText)}>{employee?.resourceName || employee?.name || ''}</span>
                {`${employee?.isTop}` === '1' && <AntdIcon type="icon-zhiding-fill" className={styles.pinBadge} />}
                {employee?.tagName && (
                  <span className={styles.tag}>
                    <span className={styles.tagText}>{employee?.tagName}</span>
                  </span>
                )}
              </span>
            </Title>
          }
          description={
            <Paragraph
              className={styles.description}
              ellipsis={{ tooltip: { title: employee?.resourceDesc, placement: 'right' } }}
            >
              {employee?.resourceDesc}
            </Paragraph>
          }
        />
      )}
    </List.Item>
  );
};

export default React.memo(EmployeeCard);
