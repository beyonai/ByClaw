import React, { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Spin, Tabs } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
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
import { useChatResourceProject } from './useChatResourceProject';
import styles from './index.module.less';

type UpperScopeKey = 'session' | 'employee';
type SecondaryState = Record<UpperScopeKey, string>;

interface ResourcePanelProps {
  sessionId: string;
  projectId?: number;
  onOpenDetail: (panel: React.ReactNode, options: DetailPanelOptions) => void;
}

const EMPTY_SECONDARY_STATE: SecondaryState = {
  session: 'file',
  employee: 'knowledge',
};

const ResourcePanel: React.FC<ResourcePanelProps> = ({ sessionId, projectId, onOpenDetail }) => {
  const intl = useIntl();
  const activeEmployee = useActiveSiderAgent();
  const { project, loading: projectLoading } = useChatResourceProject(projectId);
  const { isDevelopProjectEnabled } = useProjectTypeConfig();
  const [upperScopeKey, setUpperScopeKey] = useState<UpperScopeKey>('session');
  const [secondaryState, setSecondaryState] = useState<SecondaryState>(EMPTY_SECONDARY_STATE);
  const [sessionResourceRefreshKey, setSessionResourceRefreshKey] = useState(0);
  const resourceId = activeEmployee.resourceId || (project?.resourceId ? `${project.resourceId}` : undefined);

  // 代码入口只对已启用研发能力的项目开放；未明确的数据项按约定保留空态。
  const showCode = isDevelopProjectEnabled && project?.projectType === 'develop';

  useEffect(() => {
    if (!showCode && secondaryState.session === 'code') {
      setSecondaryState((current) => ({ ...current, session: 'file' }));
    }
  }, [secondaryState.session, showCode]);

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

  const upperSecondaryKey = secondaryState[upperScopeKey];
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
      if (upperSecondaryKey === 'model') return <ModelSiderPanel embedded showRouter />;
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
    </div>
  );
};

export default ResourcePanel;
