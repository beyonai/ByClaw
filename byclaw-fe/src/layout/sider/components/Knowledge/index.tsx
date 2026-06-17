import React from 'react';
import { useIntl, useLocation, useNavigate } from '@umijs/max';
import KnowledgeBaseTab from './components/KnowledgeBase';
import styles from './index.module.less';
import AntdIcon from '@/components/AntdIcon';
import { IDragType } from '@/components/QueryInput/withDrag';
import ActiveSiderAgentBar, { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';

interface Props {
  editable?: boolean;
  style?: React.CSSProperties;
  onSelect?: (item: any, dragType: IDragType) => void;
  keyword?: string;
  agentId?: string;
  agentIds?: string;
}

const DataCenter: React.FC<Props> = (props) => {
  const { style, onSelect, editable = true, keyword, agentId, agentIds } = props;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const intl = useIntl();

  const activeSiderAgent = useActiveSiderAgent();
  const isKnowledgeCenterPage = pathname.startsWith('/knowledgeCenter');

  return (
    <div style={style} className={styles.container}>
      <ActiveSiderAgentBar agent={activeSiderAgent} />
      <div
        className={styles.router}
        onClick={() =>
          navigate(
            isKnowledgeCenterPage
              ? {
                pathname: '/chat',
              }
              : '/knowledgeCenter',
            isKnowledgeCenterPage ? { state: { keepSiderActiveKey: 'knowledge' } } : undefined
          )
        }
      >
        <AntdIcon type="icon-zhishi" />
        <span className={styles.middle}>{intl.formatMessage({ id: 'sider.knowledgeCenter' })}</span>
        <AntdIcon
          type={isKnowledgeCenterPage ? 'icon-a-Leftzuo' : 'icon-a-Rightyou'}
          style={{ fontSize: 16, marginLeft: 'auto' }}
        />
      </div>
      <div className={styles.tabsWrapper}>
        <KnowledgeBaseTab
          editable={editable}
          onSelect={onSelect}
          keyword={keyword}
          agentId={agentId}
          agentIds={agentIds}
          activeAgentResourceId={activeSiderAgent.resourceId}
        />
      </div>
    </div>
  );
};

export default DataCenter;
