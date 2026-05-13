// tslint:disable:ordered-imports
import React, { useCallback, useMemo, useRef } from 'react';

// @ts-ignore
import { useIntl } from '@umijs/max';
import { Typography, message } from 'antd';
import classnames from 'classnames';
import AntdIcon from '@/components/AntdIcon';
import useGlobal from '@/hooks/useGlobal';
import RenderRightBottom from '@/pages/digitalEmployees/components/AllDigitalEmployees/RenderRightBottom';
import RenderRightTop from '@/pages/digitalEmployees/components/AllDigitalEmployees/RenderRightTop';
import { IAgentCache } from '@/typescript/agent';
import { getAgentChatAvatar } from '@/utils/agent';
import styles from './index.module.less';

const canJumpAgent = (agent: IAgentCache) => {
  if (!agent?.grantType) return false;

  if (agent?.agentHomeUrl) return false;

  return true;
};

const { Paragraph } = Typography;

export type IProps = {
  employee: IAgentCache;
  disableActionList?: Array<'delete' | 'apply' | 'unapply' | 'edit'>;
  onClose: () => void;
};

export const AgentInfo = (props: { employee: IAgentCache; className?: string }) => {
  const { employee, className } = props;
  const intl = useIntl();
  return (
    <div className={classnames(styles.creator, 'ub full-width ub-wrap ub-f1', className)}>
      <div className={classnames('ub ub-ac gap4')}>
        <AntdIcon type="icon-yidingyue" className={styles.antdIconStyle} />{' '}
        {Number(employee?.focusCount || 0) >= 1000 ? '999+' : employee?.focusCount || 0}
        {intl.formatMessage({ id: 'digitalEmployees.subscribers' })}
      </div>
      <div className={classnames('ub ub-ac gap4')}>
        <AntdIcon type="icon-mob-duihua02" className={styles.antdIconStyle} />{' '}
        {Number(employee?.useCount || 0) >= 1000 ? '999+' : employee?.useCount || 0}
        {intl.formatMessage({ id: 'digitalEmployees.uses' })}
      </div>
      <div className={classnames('ub ub-ac gap2 ellipsis')} title={employee?.creatorName}>
        <span>{intl.formatMessage({ id: 'digitalEmployees.creator' })}</span>
        <span className={classnames(styles.nameText, 'ellipsis ub-f1')} title={employee?.creatorName || '-'}>
          {employee?.creatorName || '-'}
        </span>
      </div>
      <div className={classnames('ub ub-ac gap2 ellipsis')} title={employee?.manUserName}>
        <span>{intl.formatMessage({ id: 'digitalEmployees.admin' })}</span>
        <span
          className={classnames(styles.nameText, 'ellipsis ub-f1')}
          title={employee?.manPrivNames || employee?.manUserName || '-'}
        >
          {employee?.manPrivNames || employee?.manUserName || '-'}
        </span>
      </div>
    </div>
  );
};

const RenderContent = (props: IProps) => {
  const { employee, disableActionList, onClose } = props;

  const intl = useIntl();

  const { setAgentId, setSessionId } = useGlobal();

  const canJump = useMemo(() => {
    return canJumpAgent(employee);
  }, [employee]);

  const onClickEmployee = useCallback(
    (employee: IAgentCache) => {
      if (employee.agentId && canJumpAgent(employee)) {
        setAgentId?.(`${employee.agentId}`);
        setSessionId?.('');

        onClose?.();
      } else {
        message.destroy();
        message.error(intl.formatMessage({ id: 'digitalEmployees.noPermission' }));
      }
    },
    [setAgentId, setSessionId, onClose]
  );

  const myDisableActionList = React.useMemo(() => {
    return [...new Set([...(disableActionList || []), 'delete', 'edit', 'unapply'])];
  }, [disableActionList]);

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
                ellipsis={{ rows: 1, tooltip: employee.name }}
              >
                {employee.name}
              </Paragraph>
              <RenderRightTop employee={employee} />
            </div>

            <Paragraph className={styles.employeeDescription} ellipsis={{ rows: 1, tooltip: employee.resourceDesc }}>
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
                <RenderRightBottom employee={employee} disableActionList={myDisableActionList} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

function AvatarCardItem(props: IProps) {
  const { employee } = props;
  const avatarCardItemRef = useRef<HTMLDivElement>(null);

  return (
    <div
      key={employee.id}
      className={classnames(styles.employeeCard, {
        pointer: true,
      })}
      ref={avatarCardItemRef}
    >
      <RenderContent {...props} />
    </div>
  );
}

export default React.memo(AvatarCardItem);
