// tslint:disable:ordered-imports
import React from 'react';
import { Button, Typography } from 'antd';
import { get } from 'lodash';
import classnames from 'classnames';
import { ArrowRightOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { useSelector, useIntl } from '@umijs/max';

import { getResponseAgentInfo } from '@/components/MessageList/utils';
import { getAgentChatAvatar } from '@/utils/agent';
import useGlobal from '@/hooks/useGlobal';
import { agentTypeMap, agentMap } from '@/constants/agent';

import type { IAgentType } from '@/typescript/agent.d';

import styles from './index.module.less';

const { Paragraph } = Typography;

type IEmployee = {
  agentSseUrl: string;
  agentType: IAgentType;
  code_type: string;
  createTime: string;
  id: number;
  intro: string;
  name: string;
  status: string;
  args: { input: string; usefulInformation?: string };
};

type IProps = {
  // eslint-disable-next-line react/no-unused-prop-types
  messageListItemContent: { substance: IEmployee[] };
};

function Employee(props: IProps) {
  const substance = get(props, 'messageListItemContent.substance') || [];
  const { EventEmitter, setAgentId } = useGlobal();

  const intl = useIntl();

  const { employeesList, defaultAgentList } = useSelector(({ employees }) => ({
    defaultAgentList: employees.agentList || [],
    employeesList: employees.employeesList,
  }));

  const sendInput = React.useCallback(
    (id: string, agentType: IAgentType, input: string, usefulInformation?: string) => {
      setAgentId?.(`${id}`);
      EventEmitter.emit('beyond-input-change-agenttype', agentType);
      EventEmitter.emit('beyond-chat-on-send-msg', {
        sendProps: {
          queryQuestion: input,
          payload: {
            agentId: id,
            extParams: {
              usefulInformation,
            },
          },
          msgOpt: {
            queryMsg: {},
            answerMsg: {
              agentId: id,
              agentType,
            },
          },
        },
      });
    },
    []
  );

  const findAgentInfo = React.useCallback(
    (agentId: string, agentType: IAgentType) => {
      let agentInfo = getResponseAgentInfo({ agentList: defaultAgentList, employeesList }, JSON.stringify({ agentId }));
      if (!agentInfo) {
        agentInfo = {
          agentType,
          agentId,
          name: intl.formatMessage({ id: 'ai-assistant' }),
          chatAvatar: agentMap?.[agentTypeMap.common]?.chatAvatar || '',
          isSuperAssistant: false,
          resourceDesc: '',
          resourceCode: '',
        };
      }

      return agentInfo;
    },
    [defaultAgentList, employeesList, intl]
  );

  return (
    <div className={classnames(styles.employeeBlock, 'ub')} style={{ flexWrap: 'wrap' }}>
      <div className={classnames(styles.tips, 'full-width')}>
        <span className="mr-8">{intl.formatMessage({ id: 'employee.recommendTip' })}</span>
        {substance.map((item, idx, arr) => {
          const agentInfo = findAgentInfo(`${item.id}`, item.agentType);
          return (
            <div style={{ display: 'inline-block' }} key={`${item.id}-${item.agentType}`}>
              <div className={classnames(styles.agentAvatarSM)} style={{ display: 'inline-block', marginRight: '2px' }}>
                {getAgentChatAvatar(agentInfo.chatAvatar)}
              </div>
              <div style={{ color: 'var(--beyond-color-primary)', display: 'inline-block' }}>{agentInfo.name}</div>
              {idx !== arr.length - 1 && <span style={{ color: 'var(--beyond-color-text-tertiary)' }}>、</span>}
            </div>
          );
        })}
        <span>{intl.formatMessage({ id: 'employee.tryTip' })}</span>
      </div>
      {substance.map((item, idx) => {
        const { name, intro, id, agentType, args } = item;

        const { input, usefulInformation } = args || {};

        const agentInfo = findAgentInfo(`${id}`, agentType);

        return (
          <div
            className={classnames(styles.employeeItem, 'ub ub-ac gap4 pointer')}
            key={idx}
            onClick={() => {
              sendInput(`${id}`, agentType, input, usefulInformation);
            }}
          >
            <div className={classnames(styles.agentAvatar)}>{getAgentChatAvatar(agentInfo.chatAvatar)}</div>
            <div className={classnames(styles.agentInfo, 'ub ub-f1 ub-ac')}>
              <div className="ub ub-ver ub-f1" style={{ marginRight: '6px' }}>
                <div className={classnames(styles.agentName, 'ellipsis ub ub-ac gap8')}>
                  <div className="ellipsis">{name}</div>
                  <span className={styles.beyondTag}>
                    <span>{intl.formatMessage({ id: 'digitalEmployees.title' })}</span>
                  </span>
                </div>
                <Paragraph className={styles.agentDescription} ellipsis={{ rows: 1 }}>
                  {intro}
                </Paragraph>
              </div>
              <Button className={classnames(styles.btn)} type="text" icon={<ArrowRightOutlined />} />
            </div>
            <div className={classnames(styles.agentInput, 'ub ub-ac ub-f1 gap8')}>
              <div className={classnames(styles.agentName, 'ellipsis ub ub-ac')} style={{ maxWidth: '200px' }}>
                <div className="ellipsis">{name}</div>:
              </div>
              <div className="ub-f1 ub ub-ac">
                <Paragraph className={classnames(styles.agentInputValue)} ellipsis={{ rows: 1 }}>
                  {input}
                </Paragraph>
              </div>

              <Button
                className={classnames(styles.btn)}
                type="primary"
                shape="circle"
                icon={<ArrowUpOutlined />}
                // onClick={() => {
                //   sendInput(`${id}`, agentType, input, usefulInformation);
                // }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default Employee;
