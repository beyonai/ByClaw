import { chatModeMap } from '@/constants/query';
import type { IChatModeType } from '@/constants/query';
import { ConfigProvider, Popover } from 'antd';
import type { PopoverProps } from 'antd';
import type { TooltipRef } from 'antd/es/tooltip';
import classNames from 'classnames';
import React, { useEffect, useLayoutEffect, useRef, useCallback, useMemo, useState } from 'react';
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
import { getResourcePopoverPanelHeight } from './resourcePopoverAdapter';

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
  const anchorRef = useRef<HTMLDivElement>(null);
  const [availableHeight, setAvailableHeight] = useState(0);
  const [navigationHeight, setNavigationHeight] = useState(0);
  // 下拉菜单、确认浮层通过 Portal 渲染到资源弹窗外部，操作期间禁止 Popover 自动关闭。
  const ignoreOutsideCloseRef = useRef<number>(0);
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
  const isResourcePicker = isAtPopover && activeTabKey !== undefined;
  // 分类完整显示即可；只有屏幕空间不足时才压缩并允许导航滚动。
  const panelHeight = isResourcePicker
    ? Math.min(availableHeight, navigationHeight)
    : 'min(65vh, calc(100vh - 32px))';
  const panelWidth = useInputWidth && width ? width : 'min(calc(100vw - 24px), 485px)';

  useLayoutEffect(() => {
    if (!open || !isResourcePicker || !anchorRef.current) return;
    const anchor = anchorRef.current;
    const viewport = window.visualViewport;
    const measure = () => {
      setAvailableHeight(
        getResourcePopoverPanelHeight(
          anchor.getBoundingClientRect(),
          placement,
          viewport?.height ?? window.innerHeight,
          viewport?.offsetTop ?? 0
        )
      );
    };
    measure();
    // 输入框增高、窗口缩放和页面滚动时同步剩余空间；关闭后解除监听。
    const observer = new ResizeObserver(measure);
    observer.observe(anchor);
    if (anchor.parentElement) observer.observe(anchor.parentElement);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
    };
  }, [open, isResourcePicker, placement, width]);

  useEffect(() => {
    if (open && popoverRef.current) {
      requestAnimationFrame(() => {
        popoverRef.current?.forceAlign();
      });
    }
  }, [open, currentAgent, panelHeight]);

  useEffect(() => {
    if (!open) return undefined;

    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // 连接器授权、凭据配置等通过 Portal 渲染到 body，操作这些浮层时不能被资源弹窗的外部点击关闭逻辑卸载。
      if (
        target.closest(
          `.${styles.popover}, [data-resource-tool-menu], .connectorItem, .connectorAction, .ant-modal-root, .ant-drawer, .ant-dropdown, .ant-dropdown-menu-item, .ant-popover, .ant-popover-content, .ant-popover-inner, .ant-popover-buttons, .ant-popconfirm`
        )
      ) {
        // Portal 浮层的关闭事件可能晚于 mousedown 到达，保留短暂保护窗口覆盖整个确认操作。
        ignoreOutsideCloseRef.current = Date.now() + 1000;
        return;
      }
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
          ref={anchorRef}
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
      // 资源面板按指定方向计算可用高度，禁止翻转；# 面板沿用默认避让。
      autoAdjustOverflow={!isAtPopover}
      ref={popoverRef}
      arrow={false}
      onOpenChange={(v) => {
        if (!v) {
          if (ignoreOutsideCloseRef.current > Date.now()) {
            return;
          }
          onClose();
        }
      }}
      styles={{
        root: { width: panelWidth, minWidth: panelWidth, maxWidth: panelWidth },
        body: {
          height: panelHeight,
          maxHeight: 'calc(100vh - 32px)',
          width: panelWidth,
          minWidth: panelWidth,
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
              maxHeight: 'calc(100vh - 32px)',
              overflow: useInputWidth ? 'hidden' : undefined,
              width: panelWidth,
              maxWidth: panelWidth,
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
                      onNavigationHeightChange={setNavigationHeight}
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
