import { chatModeMap } from '@/constants/query';
import type { IChatModeType } from '@/constants/query';
import { ConfigProvider, Popover } from 'antd';
import type { PopoverProps } from 'antd';
import type { TooltipRef } from 'antd/es/tooltip';
import classNames from 'classnames';
import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import styles from './index.module.less';
import ResourceTabs from './resourceTabsCompact';
import ResourceToolMenu from '../../components/ResourceToolMenu';
import { ResourceType } from '../utils/constants';
import type { IResourceType } from '../types';
import EmployeeList from '@/layout/sider/components/EmployeeList';
import useTracker from '@/hooks/useTracker';
import type { IAgentCache } from '@/typescript/agent';
import AntdIcon from '@/components/AntdIcon';
import { useIntl, useSelector } from '@umijs/max';
import type { IState as UseEmployeesIState } from '@/models/useEmployees.ts';
import { getAgentChatAvatar } from '@/utils/agent';
import { ResourceTypeMap } from '@/constants/resource';

interface MentionPopoverProps {
  type?: '@' | '#';
  onSelect: (item: any, type: IResourceType) => void;
  popoverPos?: React.CSSProperties;
  onClose: () => void;
  chatMode?: IChatModeType;
  inputText?: string;
  agentId?: string;
  sessionId?: string;

  /** # 引用可用的数字员工 ID，使用逗号分隔。 */
  resourceAgentIds?: string;

  /** 输入框中已经 @ 的数字员工标识，候选列表需要排除。 */
  excludedAgentIds?: string[];
  children?: React.ReactNode;
  placement?: PopoverProps['placement'];
  projectCloudResourceId?: string | number;
  projectId?: number;

  /** 打开时默认展示的资源分类。 */
  activeTabKey?: string;
}

const MentionPopover: React.FC<MentionPopoverProps> = ({
  type,
  onSelect,
  popoverPos,
  onClose,
  chatMode,
  inputText,
  agentId,
  sessionId,
  resourceAgentIds,
  excludedAgentIds,
  children,
  placement,
  projectCloudResourceId,
  projectId,
  activeTabKey,
}) => {
  const { trackerEmployeeClick } = useTracker();
  const intl = useIntl();
  const popoverRef = useRef<TooltipRef>(null);
  const open = !!popoverPos;
  const { width } = popoverPos || {};
  const isAtPopover = type === '@';

  const [currentAgent, setCurrentAgent] = useState<IAgentCache | null>(null);
  const { employeesList } = useSelector(({ employees }: { employees: UseEmployeesIState }) => employees);
  const userInfo = useSelector((state: any) => state.user?.userInfo);
  const scopedAgentId = resourceAgentIds
    ?.split(',')
    .map((item) => item.trim())
    .find(Boolean);
  const resolvedAgentId = currentAgent?.agentId || scopedAgentId || agentId;
  const isExpertResourceOverlayOpen = chatMode === chatModeMap.expert && !!currentAgent;
  const useInputWidth = isAtPopover && !isExpertResourceOverlayOpen && !!width;
  const panelHeight = useInputWidth ? '40vh' : '65vh';

  useEffect(() => {
    if (open && popoverRef.current) {
      requestAnimationFrame(() => {
        popoverRef.current?.forceAlign();
      });
    }
  }, [open, currentAgent]);

  useEffect(() => {
    if (!open) return undefined;

    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // 连接器授权、凭据配置等通过 Portal 渲染到 body，操作这些浮层时不能被资源弹窗的外部点击关闭逻辑卸载。
      if (
        target.closest(
          `.${styles.popover}, [data-resource-tool-menu], .connectorItem, .connectorAction, .ant-modal-root, .ant-drawer, .ant-dropdown, .ant-popover`
        )
      )
        return;
      onClose();
    };

    document.addEventListener('mousedown', handleDocumentMouseDown, true);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown, true);
  }, [onClose, open]);

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
      const agent = employeesList.find((item) =>
        [item.agentId, item.resourceId, item.resourceCode, item.id]
          .filter(Boolean)
          .some((identity) => `${identity}` === `${agentId}`)
      );
      setCurrentAgent(agent || null);
      return;
    }
    setCurrentAgent(null);
  }, [type, agentId, employeesList]);

  const onSelectAgentTool = useCallback(
    (item: any, type: IResourceType) => {
      if (currentAgent) {
        onSelect(
          {
            resourceId: item.resourceId,
            resourceName: item.resourceName,
            resourceCode: item.resourceCode,
            resourceBizType: item.resourceBizType || ResourceTypeMap.commonFile,
            agentId: currentAgent.agentId,
            agentName: currentAgent.name,
            agentType: currentAgent.agentType,
            chatAvatar: currentAgent.chatAvatar,
            field_id: item.resourceId,
            field_name: item.resourceName,
            field_code: item.resourceCode,
            field_desc: item.resourceDesc,
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
    const isBottomPlacement = `${placement || ''}`.startsWith('bottom');
    return (
      children || (
        <div
          style={{
            position: 'absolute',
            ...(isBottomPlacement ? { bottom: 0 } : { top: 0 }),
            left: 0,
            width: '100%',
            height: 1,
            opacity: 0,
          }}
        />
      )
    );
  }, [children, placement]);

  return (
    <Popover
      open={open}
      // 弹窗打开状态由两个入口各自的统一适配层控制，避免触发节点位置影响布局。
      trigger={[]}
      // 连接器授权等子弹窗通过 Portal 打开时，资源面板仍需保持挂载，返回后继续保留当前分类和列表状态。
      destroyOnHidden={false}
      placement={placement || (isAtPopover ? 'topLeft' : undefined)}
      // 位置由输入框所在区域统一决定：历史会话固定显示在输入框上方，新会话固定显示在下方。
      // 禁止 antd 根据可视区域自动翻转，否则历史会话可能被错误翻到输入框下方并遮挡输入框。
      autoAdjustOverflow={false}
      ref={popoverRef}
      arrow={false}
      onOpenChange={(v) => {
        if (!v) {
          onClose();
        }
      }}
      styles={{
        root: useInputWidth && width ? { width, minWidth: width, maxWidth: width } : undefined,
        body: {
          height: panelHeight,
          minWidth: 320,
          ...(useInputWidth ? { width } : {}),
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
            style={{
              height: panelHeight,
              overflow: useInputWidth ? 'hidden' : undefined,
              ...(useInputWidth && width ? { width, maxWidth: width } : {}),
            }}
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
                        showKnowledgeTab={!currentAgent || currentAgent.knowledgeCount !== 0}
                        showSkillTab={!currentAgent || currentAgent.skillsCount !== 0}
                      />
                    </div>
                  );
                }

                if (type === '@') {
                  return (
                    <ResourceToolMenu
                      keyword={inputText}
                      sessionId={sessionId}
                      projectId={projectId}
                      projectCloudResourceId={projectCloudResourceId}
                      userInfo={userInfo}
                      agentId={resolvedAgentId}
                      resourceAgentIds={resourceAgentIds}
                      excludedAgentIds={excludedAgentIds}
                      activeKey={activeTabKey}
                      onSelect={onSelect}
                    />
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
                            excludedAgentIds={excludedAgentIds}
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
                            showKnowledgeTab={!currentAgent || currentAgent.knowledgeCount !== 0}
                            showSkillTab={!currentAgent || currentAgent.skillsCount !== 0}
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
