import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Spin, Tabs } from 'antd';
import { DownOutlined, ReloadOutlined, UpOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import Knowledge from '@/layout/sider/components/Knowledge';
import ModelSiderPanel from '@/layout/sider/components/ModelSiderPanel';
import OntologySiderPanel from '@/layout/sider/components/OntologySiderPanel';
import ResourceSiderPanel from '@/layout/sider/components/ResourceSiderPanel';
import { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import type { DetailPanelOptions } from '@/layout/sider/siderContentContext';
import { useProjectTypeConfig } from '@/pages/projectSpace/hooks/useProjectTypeConfig';
import FileResourcePanel from './FileResourcePanel';
import ObjectFilesPanel from './ObjectFilesPanel';
import CodesTab from '@/layout/sider/components/ProjectSpaceList/CodesTab';
import ReposTab from '@/layout/sider/components/ProjectSpaceList/ReposTab';
import { useChatResourceProject } from './useChatResourceProject';
import styles from './index.module.less';

type UpperScopeKey = 'session' | 'employee';
type SecondaryState = Record<UpperScopeKey | 'project', string>;

interface ResourcePanelProps {
  sessionId: string;
  projectId?: number;
  onOpenDetail: (panel: React.ReactNode, options: DetailPanelOptions) => void;
}

const EMPTY_SECONDARY_STATE: SecondaryState = {
  session: 'file',
  employee: 'knowledge',
  project: 'file',
};

const ResourcePanel: React.FC<ResourcePanelProps> = ({ sessionId, projectId, onOpenDetail }) => {
  const intl = useIntl();
  const panelRef = useRef<HTMLDivElement>(null);
  const activeEmployee = useActiveSiderAgent();
  const { project, loading: projectLoading } = useChatResourceProject(projectId);
  const { isDevelopProjectEnabled } = useProjectTypeConfig();
  const [upperScopeKey, setUpperScopeKey] = useState<UpperScopeKey>('session');
  const [secondaryState, setSecondaryState] = useState<SecondaryState>(EMPTY_SECONDARY_STATE);
  const [upperSectionRatio, setUpperSectionRatio] = useState(0.5);
  const [resizing, setResizing] = useState(false);
  const [sessionResourceRefreshKey, setSessionResourceRefreshKey] = useState(0);
  const [projectResourceRefreshKey, setProjectResourceRefreshKey] = useState(0);
  const resourceId = activeEmployee.resourceId || (project?.resourceId ? `${project.resourceId}` : undefined);

  // 代码入口只对已启用研发能力的项目开放；未明确的数据项按约定保留空态。
  const showCode = isDevelopProjectEnabled && project?.projectType === 'develop';

  useEffect(() => {
    if (!showCode && (secondaryState.session === 'code' || secondaryState.project === 'code')) {
      setSecondaryState((current) => ({ ...current, session: 'file', project: 'file' }));
    }
  }, [secondaryState.project, secondaryState.session, showCode]);

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
      { key: 'file', label: label('chatResource.file') },
      { key: 'knowledge', label: label('chatResource.knowledge') },
      ...(showCode ? [{ key: 'code', label: label('chatResource.code') }] : []),
      { key: 'ontology', label: label('chatResource.ontology') },
    ];
  }, [intl, showCode, upperScopeKey]);

  const projectSecondaryItems = useMemo(() => {
    const label = (id: string) => intl.formatMessage({ id });
    return [
      { key: 'file', label: label('chatResource.file') },
      { key: 'knowledge', label: label('chatResource.knowledge') },
      ...(showCode ? [{ key: 'code', label: label('chatResource.code') }] : []),
      { key: 'ontology', label: label('chatResource.ontology') },
    ];
  }, [intl, showCode]);

  const upperSecondaryKey = secondaryState[upperScopeKey];
  const projectSecondaryKey = secondaryState.project;
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
            codeChangesEnabled
            onOpenDetail={onOpenDetail}
          />
        );
      }
      if (upperSecondaryKey === 'knowledge') {
        return (
          <ObjectFilesPanel
            objectType="knowledge"
            projectId={project?.projectId || projectId}
            sessionId={sessionId}
            refreshToken={sessionResourceRefreshKey}
            onOpenDetail={onOpenDetail}
          />
        );
      }
      if (upperSecondaryKey === 'ontology') {
        return (
          <ObjectFilesPanel
            objectType="object"
            projectId={project?.projectId || projectId}
            sessionId={sessionId}
            refreshToken={sessionResourceRefreshKey}
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
      // 模型主菜单已移除，右侧模型列表不再提供“模型中心”跳转入口。
      if (upperSecondaryKey === 'model') return <ModelSiderPanel embedded />;
      return empty;
    }

    return empty;
  }, [
    empty,
    onOpenDetail,
    project,
    projectId,
    resourceId,
    sessionResourceRefreshKey,
    sessionId,
    showCode,
    upperScopeKey,
    upperSecondaryKey,
  ]);

  const projectContent = useMemo(() => {
    if (projectSecondaryKey === 'file') {
      return (
        <FileResourcePanel
          scope="project"
          sessionId={sessionId}
          projectId={projectId}
          project={project}
          resourceId={resourceId}
          refreshKey={projectResourceRefreshKey}
          onOpenDetail={onOpenDetail}
        />
      );
    }
    if (projectSecondaryKey === 'knowledge') {
      return (
        <ObjectFilesPanel
          objectType="knowledge"
          projectId={project?.projectId || projectId}
          refreshToken={projectResourceRefreshKey}
          onOpenDetail={onOpenDetail}
        />
      );
    }
    if (projectSecondaryKey === 'ontology') {
      return (
        <ObjectFilesPanel
          objectType="object"
          projectId={project?.projectId || projectId}
          refreshToken={projectResourceRefreshKey}
          onOpenDetail={onOpenDetail}
        />
      );
    }
    if (projectSecondaryKey === 'code' && showCode) {
      return (
        <ReposTab
          projectId={Number(project?.projectId || projectId)}
          resourceId={resourceId}
          onOpenDetail={onOpenDetail}
        />
      );
    }
    return empty;
  }, [
    empty,
    onOpenDetail,
    project,
    projectResourceRefreshKey,
    projectId,
    projectSecondaryKey,
    resourceId,
    sessionId,
    showCode,
  ]);

  const updateSectionRatio = (clientY: number) => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    if (!rect.height) return;
    const minSectionHeight = Math.min(140, rect.height * 0.4);
    const minRatio = minSectionHeight / rect.height;
    const nextRatio = (clientY - rect.top) / rect.height;
    setUpperSectionRatio(Math.min(1 - minRatio, Math.max(minRatio, nextRatio)));
  };

  useEffect(() => {
    if (!resizing) return undefined;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [resizing]);

  return (
    <div ref={panelRef} className={styles.resourcePanel}>
      <section className={styles.resourceSection} style={{ flex: `0 0 ${upperSectionRatio * 100}%` }}>
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
        <Tabs
          className={styles.secondaryTabs}
          size="small"
          activeKey={upperSecondaryKey}
          tabBarExtraContent={
            upperScopeKey === 'session' && ['file', 'knowledge', 'ontology'].includes(upperSecondaryKey) ? (
              <Button
                type="text"
                className={styles.resourceRefreshButton}
                icon={<ReloadOutlined />}
                aria-label={intl.formatMessage({ id: 'common.refresh' })}
                onClick={() => setSessionResourceRefreshKey((current) => current + 1)}
              />
            ) : null
          }
          onChange={(key) => setSecondaryState((current) => ({ ...current, [upperScopeKey]: key }))}
          items={upperSecondaryItems}
        />
        <Spin spinning={projectLoading} wrapperClassName={styles.resourceSpin}>
          <div className={styles.resourceContent}>{upperContent}</div>
        </Spin>
      </section>
      <div
        className={`${styles.resourceSectionDivider} ${resizing ? styles.resourceSectionDividerActive : ''}`}
        role="separator"
        aria-orientation="horizontal"
        aria-label={intl.formatMessage({ id: 'chatResource.resizeSections' })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(upperSectionRatio * 100)}
        tabIndex={0}
        onDoubleClick={() => setUpperSectionRatio(0.5)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          setUpperSectionRatio((current) =>
            Math.min(0.8, Math.max(0.2, current + (event.key === 'ArrowDown' ? 0.05 : -0.05)))
          );
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          setResizing(true);
          updateSectionRatio(event.clientY);
        }}
        onPointerMove={(event) => {
          if (resizing) updateSectionRatio(event.clientY);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          setResizing(false);
        }}
        onPointerCancel={() => setResizing(false)}
      >
        <span className={styles.resourceSectionDividerIcon} aria-hidden>
          <UpOutlined />
          <DownOutlined />
        </span>
      </div>
      <section className={`${styles.resourceSection} ${styles.projectResourceSection}`} style={{ flex: '1 1 0' }}>
        <Tabs
          className={styles.primaryTabs}
          size="small"
          activeKey="project"
          items={[{ key: 'project', label: intl.formatMessage({ id: 'chatResource.currentProject' }) }]}
        />
        <Tabs
          className={styles.secondaryTabs}
          size="small"
          activeKey={projectSecondaryKey}
          tabBarExtraContent={
            ['file', 'knowledge', 'ontology'].includes(projectSecondaryKey) ? (
              <Button
                type="text"
                className={styles.resourceRefreshButton}
                icon={<ReloadOutlined />}
                aria-label={intl.formatMessage({ id: 'common.refresh' })}
                onClick={() => setProjectResourceRefreshKey((current) => current + 1)}
              />
            ) : null
          }
          onChange={(key) => setSecondaryState((current) => ({ ...current, project: key }))}
          items={projectSecondaryItems}
        />
        <Spin spinning={projectLoading} wrapperClassName={styles.resourceSpin}>
          <div className={styles.resourceContent}>{projectContent}</div>
        </Spin>
      </section>
    </div>
  );
};

export default ResourcePanel;
