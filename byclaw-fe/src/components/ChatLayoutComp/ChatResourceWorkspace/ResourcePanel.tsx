import React, { useEffect, useMemo, useState } from 'react';
import { Empty, Spin, Tabs } from 'antd';
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

type PrimaryKey = 'session' | 'employee' | 'project';
type SecondaryState = Record<PrimaryKey, string>;

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
  const activeEmployee = useActiveSiderAgent();
  const { project, loading: projectLoading } = useChatResourceProject(projectId);
  const { isDevelopProjectEnabled } = useProjectTypeConfig();
  const [primaryKey, setPrimaryKey] = useState<PrimaryKey>('session');
  const [secondaryState, setSecondaryState] = useState<SecondaryState>(EMPTY_SECONDARY_STATE);
  const resourceId = activeEmployee.resourceId || (project?.resourceId ? `${project.resourceId}` : undefined);

  // 代码入口只对已启用研发能力的项目开放；未明确的数据项按约定保留空态。
  const showCode = isDevelopProjectEnabled && project?.projectType === 'develop';

  useEffect(() => {
    if (!showCode && secondaryState.session === 'code') {
      setSecondaryState((current) => ({ ...current, session: 'file' }));
    }
  }, [secondaryState.session, showCode]);

  const secondaryItems = useMemo(() => {
    const label = (id: string) => intl.formatMessage({ id });
    if (primaryKey === 'employee') {
      return [
        { key: 'knowledge', label: label('chatResource.knowledge') },
        { key: 'skill', label: label('chatResource.skill') },
        { key: 'ontology', label: label('chatResource.ontology') },
        { key: 'model', label: label('chatResource.model') },
      ];
    }
    if (primaryKey === 'project') {
      return [
        { key: 'file', label: label('chatResource.file') },
        { key: 'knowledge', label: label('chatResource.knowledge') },
        ...(showCode ? [{ key: 'code', label: label('chatResource.code') }] : []),
        { key: 'ontology', label: label('chatResource.ontology') },
      ];
    }
    return [
      { key: 'file', label: label('chatResource.file') },
      ...(showCode ? [{ key: 'code', label: label('chatResource.code') }] : []),
      { key: 'ontology', label: label('chatResource.ontology') },
    ];
  }, [intl, primaryKey, showCode]);

  const secondaryKey = secondaryState[primaryKey];
  const empty = (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={intl.formatMessage({ id: 'chatResource.empty' })} />
  );

  const content = useMemo(() => {
    if (primaryKey === 'session') {
      if (secondaryKey === 'file') {
        return (
          <FileResourcePanel
            scope="session"
            sessionId={sessionId}
            projectId={projectId}
            project={project}
            resourceId={resourceId}
            onOpenDetail={onOpenDetail}
          />
        );
      }
      if (secondaryKey === 'code' && showCode) {
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
      if (secondaryKey === 'ontology') {
        return (
          <ObjectFilesPanel
            projectId={project?.projectId || projectId}
            sessionId={sessionId}
            onOpenDetail={onOpenDetail}
          />
        );
      }
      return empty;
    }

    if (primaryKey === 'employee') {
      // 右侧资源面板保留与左侧小面板一致的中心入口，但不重复展示当前数字员工栏。
      if (secondaryKey === 'knowledge') return <Knowledge embedded showRouter />;
      if (secondaryKey === 'skill') return <ResourceSiderPanel resourceType="SKILL" embedded showRouter />;
      if (secondaryKey === 'ontology') return <OntologySiderPanel embedded showRouter />;
      // 模型主菜单已移除，右侧模型列表不再提供“模型中心”跳转入口。
      if (secondaryKey === 'model') return <ModelSiderPanel embedded />;
      return empty;
    }

    if (secondaryKey === 'file') {
      return (
        <FileResourcePanel
          scope="project"
          sessionId={sessionId}
          projectId={projectId}
          project={project}
          resourceId={resourceId}
          onOpenDetail={onOpenDetail}
        />
      );
    }
    if (secondaryKey === 'ontology') {
      return <ObjectFilesPanel projectId={project?.projectId || projectId} onOpenDetail={onOpenDetail} />;
    }
    if (primaryKey === 'project' && secondaryKey === 'code' && showCode) {
      return (
        <ReposTab
          projectId={Number(project?.projectId || projectId)}
          resourceId={resourceId}
          onOpenDetail={onOpenDetail}
        />
      );
    }
    return empty;
  }, [empty, onOpenDetail, primaryKey, project, projectId, resourceId, secondaryKey, sessionId, showCode]);

  return (
    <div className={styles.resourcePanel}>
      {/* 设计稿不保留“会话资源”标题行，打开后直接展示两级筛选。 */}
      <Tabs
        className={styles.primaryTabs}
        size="small"
        activeKey={primaryKey}
        onChange={(key) => setPrimaryKey(key as PrimaryKey)}
        items={[
          { key: 'session', label: intl.formatMessage({ id: 'chatResource.currentSession' }) },
          { key: 'employee', label: intl.formatMessage({ id: 'chatResource.currentEmployee' }) },
          { key: 'project', label: intl.formatMessage({ id: 'chatResource.currentProject' }) },
        ]}
      />
      <Tabs
        className={styles.secondaryTabs}
        size="small"
        activeKey={secondaryKey}
        onChange={(key) => setSecondaryState((current) => ({ ...current, [primaryKey]: key }))}
        items={secondaryItems}
      />
      <Spin spinning={projectLoading} wrapperClassName={styles.resourceSpin}>
        <div className={styles.resourceContent}>{content}</div>
      </Spin>
    </div>
  );
};

export default ResourcePanel;
