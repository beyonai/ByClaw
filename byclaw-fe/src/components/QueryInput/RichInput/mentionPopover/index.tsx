import { chatModeMap, IChatModeType } from '@/constants/query';
import { ConfigProvider, Popover, PopoverProps } from 'antd';
import { TooltipRef } from 'antd/es/tooltip';
import classNames from 'classnames';
import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import styles from './index.module.less';
import ResourceTabs from './resourceTabs';
import { ResourceType } from '../utils/constants';
import { IResourceType } from '../types';
import EmployeeList from '@/layout/sider/components/EmployeeList';
import useTracker from '@/hooks/useTracker';
import { IAgentCache } from '@/typescript/agent';
import AntdIcon from '@/components/AntdIcon';
import { useIntl, useSelector } from '@umijs/max';
import type { IState as UseEmployeesIState } from '@/models/useEmployees.ts';
import { getAgentChatAvatar } from '@/utils/agent';
import { ResourceTypeMap } from '@/constants/resource';

const MentionPopover = ({
  type,
  onSelect,
  popoverPos,
  onClose,
  chatMode,
  inputText,
  agentId,
  sessionId,
  resourceAgentIds,
  children,
  placement,
}: {
  type?: '@' | '#';
  onSelect: (item: any, type: IResourceType) => void;
  popoverPos?: React.CSSProperties;
  onClose: () => void;
  chatMode?: IChatModeType;
  inputText?: string;
  agentId?: string;
  sessionId?: string;
  resourceAgentIds?: string; // 用逗号分隔
  children?: React.ReactNode;
  placement?: PopoverProps['placement'];
}) => {
  const { trackerEmployeeClick } = useTracker();
  const intl = useIntl();
  const popoverRef = useRef<TooltipRef>(null);
  const open = !!popoverPos;
  const { top, left } = popoverPos || {};

  const [currentAgent, setCurrentAgent] = useState<IAgentCache | null>(null);
  const { employeesList } = useSelector(({ employees }: { employees: UseEmployeesIState }) => employees);
  const resolvedAgentId = currentAgent?.agentId || agentId;
  const isExpertResourceOverlayOpen = chatMode === chatModeMap.expert && !!currentAgent;

  useEffect(() => {
    if (open && popoverRef.current) {
      requestAnimationFrame(() => {
        popoverRef.current?.forceAlign();
      });
    }
  }, [open, top, left, currentAgent]);

  const onSelectAtMention = useCallback(
    (item: any) => {
      trackerEmployeeClick(item, 'AtAgentRedirect');

      onSelect(item, ResourceType.digitalEmployee);
    },
    [onSelect]
  );

  const renderActionIcon = useCallback(
    (employee: IAgentCache) => {
      if (employee.integrationType === 'PAGE') {
        return null;
      }
      if (employee.knowledgeCount === 0 && employee.skillsCount === 0) {
        return null;
      }
      return (
        <AntdIcon
          type="icon-ziyuan"
          title={`${intl.formatMessage({ id: 'sider.knowledge' })} / ${intl.formatMessage({ id: 'common.skills' })}`}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setCurrentAgent(employee);
          }}
        />
      );
    },
    [intl]
  );

  useEffect(() => {
    if (agentId && type === '#') {
      const agent = employeesList.find(
        (item) => `${item.agentId}` === `${agentId}` || `${item.resourceCode}` === `${agentId}`
      );
      if (agent) {
        setCurrentAgent(agent);
      }
    }
  }, [type, agentId, employeesList]);

  const onSelectAgentTool = useCallback(
    (item: any, type: IResourceType) => {
      if (currentAgent) {
        onSelect(
          {
            resourceId: item.resourceId,
            resourceName: item.resourceName,
            resourceCode: item.resourceCode,
            resourceBizType: item.resourceBizType || ResourceTypeMap.file,
            agentId: currentAgent.agentId,
            agentName: currentAgent.name,
            agentType: currentAgent.agentType,
            chatAvatar: currentAgent.chatAvatar,
          },
          ResourceType.agentTool
        );
      } else {
        onSelect(item, type);
      }
    },
    [currentAgent, onSelect]
  );

  const resourceHeader = useMemo(() => {
    if (!currentAgent || type === '#') {
      return null;
    }
    return (
      <div className="ub ub-ac" style={{ marginBottom: 10 }}>
        <AntdIcon
          type="icon-a-Arrow-leftjiantouzuo"
          onClick={() => {
            setCurrentAgent(null);
          }}
        />
        {getAgentChatAvatar(currentAgent.chatAvatar, '', {
          width: 20,
          height: 20,
          verticalAlign: 'text-top',
          marginRight: 6,
          marginLeft: 12,
        })}
        <span style={{ fontSize: 15, fontWeight: 500 }}>{currentAgent.name}</span>
      </div>
    );
  }, [type, currentAgent]);

  const trigger = useMemo(() => {
    return (
      children || (
        <div
          style={{
            top,
            left,
            position: 'fixed',
            width: 1,
            height: 1,
            opacity: 0,
          }}
        />
      )
    );
  }, [children, top, left]);

  return (
    <Popover
      open={open}
      trigger="click"
      placement={placement}
      ref={popoverRef}
      arrow={false}
      onOpenChange={(v) => {
        if (!v) {
          onClose();
        }
      }}
      styles={{
        body: {
          height: '50vh',
          minWidth: 320,
          padding: 0,
        },
      }}
      classNames={{
        root: classNames(styles.popover),
      }}
      content={
        <ConfigProvider
          theme={{
            components: {
              List: {
                avatarMarginRight: 10,
              },
            },
          }}
        >
          <div
            className={classNames(styles.contentViewport, {
              [styles.contentViewportWide]: isExpertResourceOverlayOpen,
            })}
          >
            <div className={styles.contentInner}>
              {(() => {
                if (type === '#') {
                  return (
                    <div className={styles.resourceTabsWrap}>
                      <ResourceTabs
                        open={open}
                        agentId={resolvedAgentId}
                        sessionId={sessionId}
                        onSelect={onSelectAgentTool}
                        keyword={inputText}
                        agentIds={resourceAgentIds}
                        showKnowledgeTab={!!currentAgent && currentAgent.knowledgeCount !== 0}
                        showSkillTab={!!currentAgent && currentAgent.skillsCount !== 0}
                      />
                    </div>
                  );
                }

                if (chatMode === chatModeMap.expert) {
                  return (
                    <div className={styles.employeeWrap}>
                      {!currentAgent ? (
                        <div className={styles.employeeListWrap}>
                          <EmployeeList
                            chatMode={chatMode}
                            keyword={inputText}
                            onSelect={onSelectAtMention}
                            renderActionIcon={renderActionIcon}
                          />
                        </div>
                      ) : (
                        <div className={styles.agentSkillsWrap}>
                          <ResourceTabs
                            agentId={resolvedAgentId}
                            sessionId={sessionId}
                            onSelect={onSelectAgentTool}
                            header={resourceHeader}
                            showKnowledgeTab={!!currentAgent && currentAgent.knowledgeCount !== 0}
                            showSkillTab={!!currentAgent && currentAgent.skillsCount !== 0}
                          />
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              })()}
            </div>
          </div>
        </ConfigProvider>
      }
    >
      {trigger}
    </Popover>
  );
};
export default MentionPopover;
