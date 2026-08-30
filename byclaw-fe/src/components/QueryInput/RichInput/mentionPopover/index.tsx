import { chatModeMap } from '@/constants/query';
import type { IChatModeType } from '@/constants/query';
import { ConfigProvider, Empty, List, Popover, Spin } from 'antd';
import type { PopoverProps } from 'antd';
import type { TooltipRef } from 'antd/es/tooltip';
import classNames from 'classnames';
import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import styles from './index.module.less';
import ResourceTabs from './resourceTabsCompact';
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
import { searchDirAndFile } from '@/service/knowledgeCenter';
import { normalizeProjectCloudDriveItem } from '@/components/ProjectCloudDrive';
import { getFileIconType } from '@/constants/icon';

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
}) => {
  const { trackerEmployeeClick } = useTracker();
  const intl = useIntl();
  const popoverRef = useRef<TooltipRef>(null);
  // 项目云盘 @ 搜索需要等用户输入关键词后再展示，单独输入 @ 时不弹空面板。
  const open = !!popoverPos && (type !== '@' || !projectCloudResourceId || !!inputText?.trim());
  const { top, left } = popoverPos || {};

  const [currentAgent, setCurrentAgent] = useState<IAgentCache | null>(null);
  const [projectFiles, setProjectFiles] = useState<any[]>([]);
  const [projectFilesLoading, setProjectFilesLoading] = useState(false);
  const { employeesList } = useSelector(({ employees }: { employees: UseEmployeesIState }) => employees);
  const scopedAgentId = resourceAgentIds
    ?.split(',')
    .map((item) => item.trim())
    .find(Boolean);
  const resolvedAgentId = currentAgent?.agentId || scopedAgentId || agentId;
  const isExpertResourceOverlayOpen = chatMode === chatModeMap.expert && !!currentAgent;

  useEffect(() => {
    if (type !== '@' || !projectCloudResourceId || !inputText?.trim()) {
      setProjectFiles([]);
      return;
    }
    let active = true;
    setProjectFilesLoading(true);
    searchDirAndFile({
      resourceId: Number(projectCloudResourceId),
      directoryPath: '/',
      keyword: inputText.trim(),
    })
      .then((response: any) => {
        if (!active) return;
        const data = response?.data ?? response;
        const rows = Array.isArray(data)
          ? data
          : data?.list || data?.rows || data?.records || data?.data?.list || data?.data?.rows || [];
        setProjectFiles(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (active) setProjectFiles([]);
      })
      .finally(() => {
        if (active) setProjectFilesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [inputText, projectCloudResourceId, type]);

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
          height: '65vh',
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
                        showKnowledgeTab={!currentAgent || currentAgent.knowledgeCount !== 0}
                        showSkillTab={!currentAgent || currentAgent.skillsCount !== 0}
                      />
                    </div>
                  );
                }

                if (type === '@' && projectCloudResourceId) {
                  return (
                    <div className={styles.projectFileSearchPanel}>
                      <Spin spinning={projectFilesLoading}>
                        {projectFiles.length ? (
                          <List
                            dataSource={projectFiles}
                            renderItem={(item: any) => {
                              const name = item.fileName || item.name || '文件';
                              const normalizedItem = normalizeProjectCloudDriveItem(item);
                              const path = normalizedItem.path;
                              const resourceType = normalizedItem.isDir
                                ? ResourceType.commonFolder
                                : ResourceType.commonFile;
                              return (
                                <List.Item
                                  className={styles.projectFileSearchItem}
                                  onClick={() =>
                                    onSelect(
                                      { id: path, collectionName: name, resourceId: path, resourceName: name },
                                      resourceType
                                    )
                                  }
                                >
                                  <span className={styles.projectFileSearchContent}>
                                    <AntdIcon
                                      type={`icon-${
                                        normalizedItem.isDir ? 'a-Folder-openwenjianjia-kai' : getFileIconType(name)
                                      }`}
                                      className={styles.projectFileSearchIcon}
                                    />
                                    <span className={styles.projectFileSearchName} title={name}>
                                      {name}
                                    </span>
                                    <span className={styles.projectFileSearchType}>
                                      {normalizedItem.isDir ? '文件夹' : '文件'}
                                    </span>
                                  </span>
                                </List.Item>
                              );
                            }}
                          />
                        ) : (
                          !projectFilesLoading && (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无匹配文件" />
                          )
                        )}
                      </Spin>
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
