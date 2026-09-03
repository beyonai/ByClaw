import React, { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Spin, Tabs } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { getAgentChatAvatar } from '@/utils/agent';
import Knowledge from '@/layout/sider/components/Knowledge';
import ModelSiderPanel from '@/layout/sider/components/ModelSiderPanel';
import OntologySiderPanel from '@/layout/sider/components/OntologySiderPanel';
import ResourceSiderPanel from '@/layout/sider/components/ResourceSiderPanel';
import { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import type { DetailPanelOptions } from '@/layout/sider/siderContentContext';
import FileResourcePanel from './FileResourcePanel';
import CodesTab from '@/layout/sider/components/ProjectSpaceList/CodesTab';
import { listAvailableProjectRepos } from '@/service/devloop';
import { useChatResourceProject } from './useChatResourceProject';
import { getSessionFileTabKeys, type SessionFileTabKey } from './resourceTabUtils';
import styles from './index.module.less';

type UpperScopeKey = 'session' | 'employee';
type SecondaryState = Record<UpperScopeKey, string>;

const SESSION_FILE_TAB_LABEL_IDS: Record<SessionFileTabKey, string> = {
  file: 'chatResource.processFile',
  sharedFile: 'chatResource.localSharedFile',
  projectFile: 'chatResource.projectCloudDrive',
};

interface ResourcePanelProps {
  sessionId: string;
  projectId?: number;
  cloudResourceId?: string | number;
  onOpenDetail: (panel: React.ReactNode, options: DetailPanelOptions) => void;
}

const EMPTY_SECONDARY_STATE: SecondaryState = {
  session: 'file',
  employee: 'knowledge',
};

const ResourcePanel: React.FC<ResourcePanelProps> = ({ sessionId, projectId, cloudResourceId, onOpenDetail }) => {
  const intl = useIntl();
  const isEnglish = intl.locale.toLowerCase().startsWith('en');
  const activeEmployee = useActiveSiderAgent();
  const { project, loading: projectLoading } = useChatResourceProject(projectId);
  const [upperScopeKey, setUpperScopeKey] = useState<UpperScopeKey>('session');
  const [secondaryState, setSecondaryState] = useState<SecondaryState>(EMPTY_SECONDARY_STATE);
  const [sessionResourceRefreshKey, setSessionResourceRefreshKey] = useState(0);
  const [availableRepoCount, setAvailableRepoCount] = useState<number | null>(null);
  const resourceId = activeEmployee.resourceId || (project?.resourceId ? `${project.resourceId}` : undefined);
  const resolvedProjectId = Number(project?.projectId ?? projectId);
  const sessionFileTabKeys = useMemo(() => getSessionFileTabKeys(resolvedProjectId), [resolvedProjectId]);
  const showProjectCloudDrive = sessionFileTabKeys.includes('projectFile');
  // 项目云盘只能使用项目知识库 ID；未初始化知识库时保留空值并展示对应空态。
  const rawProjectCloudResourceId = cloudResourceId ?? project?.cloudResourceId;
  const projectCloudResourceId = rawProjectCloudResourceId ? `${rawProjectCloudResourceId}` : undefined;

  // 只有当前会话实际可访问到至少一个仓库时才展示项目代码。
  // null 表示仍在查询，避免先显示再隐藏造成菜单闪烁。
  const showCode = Boolean(sessionId && availableRepoCount !== null && availableRepoCount > 0);

  useEffect(() => {
    let disposed = false;
    setAvailableRepoCount(null);
    if (!projectId || !sessionId) {
      return () => {
        disposed = true;
      };
    }
    void listAvailableProjectRepos(projectId, sessionId)
      .then((repos) => {
        if (!disposed) setAvailableRepoCount(Array.isArray(repos) ? repos.length : 0);
      })
      .catch(() => {
        // 仓库可用性查询失败时不展示入口，避免打开后必然得到空代码页。
        if (!disposed) setAvailableRepoCount(0);
      });
    return () => {
      disposed = true;
    };
  }, [projectId, sessionId, sessionResourceRefreshKey]);

  useEffect(() => {
    if (!showCode && secondaryState.session === 'code') {
      setSecondaryState((current) => ({ ...current, session: 'file' }));
    }
  }, [secondaryState.session, showCode]);

  useEffect(() => {
    if (!showProjectCloudDrive && secondaryState.session === 'projectFile') {
      setSecondaryState((current) => ({ ...current, session: 'sharedFile' }));
    }
  }, [secondaryState.session, showProjectCloudDrive]);

  const upperSecondaryItems = useMemo(() => {
    const label = (id: string) => intl.formatMessage({ id });
    if (upperScopeKey === 'employee') {
      return [
        { key: 'knowledge', label: label('chatResource.knowledge') },
        { key: 'skill', label: label('chatResource.skill') },
        { key: 'ontology', label: label('chatResource.ontology') },
        { key: 'model', label: label('chatResource.model') },
      ];
    }
    return [
      ...sessionFileTabKeys.map((key) => ({ key, label: label(SESSION_FILE_TAB_LABEL_IDS[key]) })),
      ...(showCode ? [{ key: 'code', label: label('chatResource.projectCode') }] : []),
    ];
  }, [intl, sessionFileTabKeys, showCode, upperScopeKey]);

  const upperSecondaryKey = secondaryState[upperScopeKey];
  const showSecondaryRefresh =
    upperScopeKey === 'session' && ['file', 'sharedFile', 'projectFile', 'code'].includes(upperSecondaryKey);
  const empty = (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={intl.formatMessage({ id: 'chatResource.empty' })} />
  );

  const upperContent = useMemo(() => {
    if (upperScopeKey === 'session') {
      if (upperSecondaryKey === 'file') {
        return (
          <FileResourcePanel
            scope="session"
            sessionId={sessionId}
            projectId={projectId}
            project={project}
            projectCloudResourceId={projectCloudResourceId}
            resourceId={resourceId}
            refreshKey={sessionResourceRefreshKey}
            onOpenDetail={onOpenDetail}
          />
        );
      }
      if (upperSecondaryKey === 'projectFile') {
        return (
          <FileResourcePanel
            scope="project"
            sessionId={sessionId}
            projectId={resolvedProjectId}
            project={project}
            resourceId={projectCloudResourceId}
            refreshKey={sessionResourceRefreshKey}
            onOpenDetail={onOpenDetail}
          />
        );
      }
      if (upperSecondaryKey === 'sharedFile') {
        return (
          <FileResourcePanel
            scope="shared"
            sessionId={sessionId}
            projectId={resolvedProjectId}
            project={project}
            projectCloudResourceId={projectCloudResourceId}
            resourceId={resourceId}
            refreshKey={sessionResourceRefreshKey}
            onOpenDetail={onOpenDetail}
          />
        );
      }
      if (upperSecondaryKey === 'code' && showCode) {
        return (
          <CodesTab
            projectId={Number(project?.projectId || projectId)}
            resourceId={resourceId}
            sessionId={sessionId}
            refreshKey={sessionResourceRefreshKey}
            codeChangesEnabled
            onOpenDetail={onOpenDetail}
          />
        );
      }
      return empty;
    }

    if (upperScopeKey === 'employee') {
      // 右侧资源面板保留与左侧小面板一致的中心入口，但不重复展示当前数字员工栏。
      if (upperSecondaryKey === 'knowledge') return <Knowledge embedded showRouter />;
      if (upperSecondaryKey === 'skill') return <ResourceSiderPanel resourceType="SKILL" embedded showRouter />;
      if (upperSecondaryKey === 'ontology') return <OntologySiderPanel embedded showRouter />;
      if (upperSecondaryKey === 'model') return <ModelSiderPanel embedded showRouter />;
      return empty;
    }

    return empty;
  }, [
    empty,
    onOpenDetail,
    project,
    projectCloudResourceId,
    projectId,
    resolvedProjectId,
    resourceId,
    sessionResourceRefreshKey,
    sessionId,
    showCode,
    upperScopeKey,
    upperSecondaryKey,
  ]);

  return (
    <div className={styles.resourcePanel}>
      <section className={styles.resourceSection}>
        <Tabs
          className={styles.primaryTabs}
          size="small"
          activeKey={upperScopeKey}
          onChange={(key) => setUpperScopeKey(key as UpperScopeKey)}
          items={[
            { key: 'session', label: intl.formatMessage({ id: 'chatResource.currentSession' }) },
            { key: 'employee', label: intl.formatMessage({ id: 'chatResource.currentEmployee' }) },
          ]}
        />
        <div className={styles.resourceBody}>
          <div className={styles.resourceMain}>
            {upperScopeKey === 'employee' && activeEmployee.resourceId ? (
              <div className={styles.currentEmployeeRow}>
                <span className={styles.currentEmployeeAvatar}>{getAgentChatAvatar(activeEmployee.avatar)}</span>
                <span className={styles.currentEmployeeName} title={activeEmployee.name}>
                  {activeEmployee.name}
                </span>
              </div>
            ) : null}
            <Spin spinning={projectLoading} wrapperClassName={styles.resourceSpin}>
              <div className={styles.resourceContent}>{upperContent}</div>
            </Spin>
          </div>
          <aside
            className={styles.secondaryNav}
            aria-label={intl.formatMessage({
              id: upperScopeKey === 'session' ? 'chatResource.currentSession' : 'chatResource.currentEmployee',
            })}
          >
            {showSecondaryRefresh ? (
              <div className={styles.secondaryNavActions}>
                <Button
                  type="text"
                  className={styles.resourceRefreshButton}
                  icon={<ReloadOutlined />}
                  aria-label={intl.formatMessage({ id: 'common.refresh' })}
                  onClick={() => setSessionResourceRefreshKey((current) => current + 1)}
                />
              </div>
            ) : null}
            <Tabs
              tabPosition="right"
              className={`${styles.secondaryTabs} ${isEnglish ? styles.secondaryTabsEnglish : ''}`}
              size="small"
              activeKey={upperSecondaryKey}
              onChange={(key) => setSecondaryState((current) => ({ ...current, [upperScopeKey]: key }))}
              items={upperSecondaryItems}
            />
          </aside>
        </div>
      </section>
    </div>
  );
};

export default ResourcePanel;
