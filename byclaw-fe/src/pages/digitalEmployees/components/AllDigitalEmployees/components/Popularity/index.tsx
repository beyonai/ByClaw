// tslint:disable:ordered-imports
import React, { useState, useEffect, useCallback } from 'react';
import classnames from 'classnames';
import { isEmpty, noop } from 'lodash';
// @ts-ignore
import { useIntl, useNavigate } from '@umijs/max';
import { message } from 'antd';
import useGlobal from '@/hooks/useGlobal';

import useTracker from '@/hooks/useTracker';
import { getAgentChatAvatar, agentHandler, getAgentPath, canJumpAgent } from '@/utils/agent';
import { queryPopular } from '@/service/digitalEmployees';

import RenderRightBottom from '@/pages/digitalEmployees/components/AllDigitalEmployees/RenderRightBottom';
import RenderRightTop from '@/pages/digitalEmployees/components/AllDigitalEmployees/RenderRightTop';

import { IProps as IAvatarCardItemProps } from '../AvatarCardItem';
import { IAgent, IAgentCache } from '@/typescript/agent';

import styles from './index.module.less';

const Popularity = ({ disableActionList }: { disableActionList?: IAvatarCardItemProps['disableActionList'] }) => {
  const intl = useIntl();
  const [list, setList] = useState<IAgentCache[]>([]);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);

  const { EventEmitter, setAgentId, setSessionId } = useGlobal();
  const navigate = useNavigate();
  const { trackerEmployeeClick } = useTracker();

  useEffect(() => {
    queryPopular({
      terminals: ['ALL', 'PC'],
      pageNum: 1,
      pageSize: 10,
    }).then((res) => {
      const { list = [] } = res || {};
      setList(list.map((item: IAgent) => agentHandler(item)));
    });
  }, []);

  const onClickEmployee = useCallback(
    (employee: IAgentCache) => {
      const isCanJump = canJumpAgent(employee);
      if (employee.agentId && isCanJump) {
        trackerEmployeeClick(employee, 'marketAgentRedirect');

        setAgentId?.(`${employee.agentId}`);
        setSessionId?.('');
        navigate(getAgentPath(employee));
      } else {
        message.destroy();
        message.error(intl.formatMessage({ id: 'digitalEmployees.noPermission' }));
      }
    },
    [setAgentId, setSessionId]
  );

  // 使用原生事件监听器处理滚轮事件，避免 passive 事件监听器的问题
  useEffect(() => {
    const element = scrollContainerRef.current;

    if (!element) return noop;

    const handleWheel = (e: WheelEvent) => {
      const { scrollLeft, scrollWidth, clientWidth } = element;
      const maxScrollLeft = scrollWidth - clientWidth;
      const canScrollHorizontally = maxScrollLeft > 0;

      // 判断是垂直滚轮（deltaY 有值且大于 deltaX，或者只有 deltaY）
      const hasVerticalDelta = Math.abs(e.deltaY) > 0;
      const isVerticalWheel = hasVerticalDelta && Math.abs(e.deltaY) >= Math.abs(e.deltaX);

      if (isVerticalWheel && canScrollHorizontally) {
        // 垂直滚轮转换为横向滚动
        e.preventDefault();
        e.stopPropagation();

        // 计算新的滚动位置，使用 deltaY 的值
        const newScrollLeft = scrollLeft + e.deltaY;
        const clampedScrollLeft = Math.max(0, Math.min(newScrollLeft, maxScrollLeft));
        element.scrollLeft = clampedScrollLeft;
      } else if (Math.abs(e.deltaX) > 0 && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // 横向滚轮：允许默认横向滚动行为，但阻止冒泡到外层容器
        e.stopPropagation();
      } else {
        // 其他情况：阻止冒泡到外层容器，但不阻止默认滚动行为
        e.stopPropagation();
      }
    };

    // 使用 { passive: false } 确保可以调用 preventDefault
    element.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      element.removeEventListener('wheel', handleWheel);
    };
  }, [isEmpty(list)]);

  useEffect(() => {
    const handler = (param: {
      unApplyList?: string[];
      ApplyList?: string[];

      delIdList?: string[];
      pinList?: string[];
      unpinList?: string[];
    }) => {
      const { unApplyList = [], ApplyList = [], delIdList = [] } = param || {};

      setList((prevList) => {
        return [
          ...prevList.map((item: IAgentCache) => {
            if (ApplyList.includes(`${item.id}`)) {
              return {
                ...item,
                approveStatus: 'S',
              };
            }
            if (unApplyList.includes(`${item.id}`)) {
              return {
                ...item,
                approveStatus: '',
                grantType: undefined,
                authorizeMe: false,
              };
            }
            if (delIdList.includes(`${item.agentId}`)) {
              return null;
            }
            return item;
          }),
        ].filter(Boolean) as IAgentCache[];
      });
    };
    EventEmitter.on('beyond-update-employee', handler);
    return () => {
      EventEmitter.off('beyond-update-employee', handler);
    };
  }, [EventEmitter]);

  if (isEmpty(list)) return null;

  return (
    <div className={styles.popularityBlock} data-popularity-block>
      <p style={{ fontWeight: 'bold', margin: '0 0 6px' }}>{intl.formatMessage({ id: 'digitalEmployees.popular' })}</p>
      <div style={{ position: 'relative' }}>
        <div className={styles.carouselCardIconLeft} />
        <div ref={scrollContainerRef} className="overflow-auto hideThumb full-width" style={{ padding: '0 15px' }}>
          <div style={{ width: 'max-content' }} className="ub ub-ac gap12">
            {list.map((agent: IAgentCache, idx: number) => {
              const { name, resourceDesc } = agent;

              return (
                <div
                  className={classnames(styles.popularityItem, 'ub ub-ver ub-ps ub-ac gap8 pointer')}
                  onClick={() => {
                    onClickEmployee(agent);
                  }}
                  key={agent.agentId}
                >
                  <div
                    className={classnames(styles.rank, 'ub ub-ac ub-pc', {
                      [styles.reds]: idx === 0,
                      [styles.oranges]: idx === 1,
                      [styles.yellows]: idx === 2,
                    })}
                  >
                    {idx + 1}
                  </div>
                  <div className={styles.renderRightTop}>
                    <RenderRightTop employee={agent} />
                  </div>
                  <div className={styles.avatarContainer}>
                    <div className={styles.avatar}>{getAgentChatAvatar(agent.chatAvatar)}</div>
                  </div>
                  <div
                    className="ellipsis full-width"
                    style={{ fontWeight: 500, fontSize: '14px', textAlign: 'center' }}
                    title={name}
                  >
                    {name}
                  </div>
                  <div
                    className="ellipsis full-width"
                    style={{ color: 'var(--beyond-color-text-secondary)', fontSize: '12px', textAlign: 'center' }}
                    title={resourceDesc}
                  >
                    {resourceDesc}
                  </div>
                  <div
                    className={classnames('ub ub-ac ub-pc gap6 overflow-hidden full-width', styles.infoBlock)}
                    style={{ fontSize: '12px', color: 'var(--beyond-color-text-tertiary)' }}
                  >
                    <div className={classnames('ub ub-ac gap2')} title={agent?.creatorName || '-'}>
                      <span style={{ minWidth: '46px' }}>{intl.formatMessage({ id: 'digitalEmployees.creator' })}</span>
                      <span className="ellipsis" style={{ flex: '1 1 auto', minWidth: 0 }}>
                        {agent?.creatorName || '-'}
                      </span>
                    </div>
                  </div>
                  <div
                    className={classnames(styles.renderRightBottom, 'ub ub-ac ub-pc gap8 full-width')}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                  >
                    <RenderRightBottom employee={agent} disableActionList={disableActionList} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className={styles.carouselCardIconRight} />
      </div>
    </div>
  );
};

export default Popularity;
