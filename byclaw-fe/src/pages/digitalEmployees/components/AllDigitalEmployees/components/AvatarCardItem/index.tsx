// tslint:disable:ordered-imports
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// @ts-ignore
import { useIntl, useNavigate } from '@umijs/max';
import { Skeleton, Typography, message } from 'antd';
import classnames from 'classnames';
import { debounce, noop } from 'lodash';
import useGlobal from '@/hooks/useGlobal';
import RenderRightBottom from '@/pages/digitalEmployees/components/AllDigitalEmployees/RenderRightBottom';
import RenderRightTop from '@/pages/digitalEmployees/components/AllDigitalEmployees/RenderRightTop';
import { IAgentCache } from '@/typescript/agent';
import { canJumpAgent, getAgentChatAvatar, getAgentPath } from '@/utils/agent';
import useTracker from '@/hooks/useTracker';
import styles from './index.module.less';

const { Paragraph } = Typography;

export type IProps = {
  employee: IAgentCache;
  disableActionList?: Array<'delete' | 'apply' | 'unapply' | 'edit'>;
  topRightTagText?: string;
  allowDelete?: boolean;
};

export const AgentInfo = (props: { employee: IAgentCache; className?: string }) => {
  const { employee, className } = props;
  const intl = useIntl();
  return (
    <div className={classnames(styles.creator, 'ub ub-ac full-width ub-wrap', className)}>
      <div className={classnames('ub ub-ac gap2 ellipsis')} title={employee?.creatorName}>
        <span>{intl.formatMessage({ id: 'digitalEmployees.creator' })}</span>
        <span
          className={classnames(styles.nameText, 'ellipsis ub-f1')}
          title={employee?.creatorName || employee?.createUserName || '-'}
        >
          {employee?.creatorName || employee?.createUserName || '-'}
        </span>
      </div>
    </div>
  );
};

const RenderContent = (props: IProps) => {
  const { employee, disableActionList, allowDelete } = props;

  const navigate = useNavigate();
  const intl = useIntl();

  const { trackerEmployeeClick } = useTracker();
  const { setAgentId, setSessionId } = useGlobal();

  const canJump = useMemo(() => {
    return canJumpAgent(employee);
  }, [employee]);

  const onClickEmployee = useCallback(
    (employee: IAgentCache) => {
      if (employee.agentId && canJumpAgent(employee)) {
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

  return (
    <div className={classnames(styles.renderContent, 'full-width full-height')}>
      <div
        className={classnames('ub ub-ver full-width full-height', {
          pointer: canJump,
        })}
        onClick={() => onClickEmployee(employee)}
      >
        <div className="ub gap8 full-height">
          <div className={styles.avatarContainer}>
            <div className={styles.avatar}>{getAgentChatAvatar(employee.chatAvatar)}</div>
          </div>
          <div className={classnames(styles.employeeInfo, 'ub ub-ver ub-f1')}>
            <div className={classnames('ub gap4 ub-ac', styles.employeeInfoHeader)}>
              <Paragraph
                className={classnames(styles.employeeName, 'ub-f1')}
                ellipsis={{ rows: 1, tooltip: employee.name || employee.resourceName }}
              >
                {employee.name || employee.resourceName}
              </Paragraph>
              <RenderRightTop employee={employee} />
            </div>

            <Paragraph className={styles.employeeDescription} ellipsis={{ rows: 2, tooltip: employee.resourceDesc }}>
              {employee.resourceDesc}
            </Paragraph>

            <div className={classnames(styles.meta, 'ub ub-ac')} style={{ minHeight: '22px' }}>
              <AgentInfo employee={employee} />
              <div
                className={styles.renderRightBottom}
                style={{ marginLeft: 'auto' }}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
              >
                <RenderRightBottom
                  employee={employee}
                  disableActionList={disableActionList}
                  allowDelete={allowDelete}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

function AvatarCardItem(props: IProps) {
  const { employee, topRightTagText } = props;
  const avatarCardItemRef = useRef<HTMLDivElement>(null);

  const [canShow, setCanShow] = useState<boolean>(false);

  useEffect(() => {
    if (!avatarCardItemRef.current || canShow) return noop;

    let observer: any;

    const callback = debounce((entries) => {
      entries.forEach((entry: IntersectionObserverEntry) => {
        if (entry.intersectionRatio > 0) {
          // 元素进入可视区域
          setCanShow(true);
          observer?.disconnect();
        } else {
          // 元素离开可视区域
        }
      });
    }, 100);

    observer = new IntersectionObserver(callback);
    observer.observe(avatarCardItemRef.current);
    return () => {
      observer.disconnect();
    };
  }, [canShow]);

  return (
    <div
      key={employee.id}
      className={classnames(styles.employeeCard, {
        pointer: true,
      })}
      ref={avatarCardItemRef}
    >
      {topRightTagText ? <div className={styles.topRightTag}>{topRightTagText}</div> : null}
      {canShow && <RenderContent {...props} />}
      {!canShow && (
        <div style={{ padding: 12 }} className="full-width full-height">
          <Skeleton avatar paragraph={{ rows: 1 }} />
        </div>
      )}
    </div>
  );
}

export default React.memo(AvatarCardItem);
