import React from 'react';
import { useIntl } from '@umijs/max';
import KnowledgeBaseTab from './components/KnowledgeBase';
import styles from './index.module.less';
import AntdIcon from '@/components/AntdIcon';
import { IDragType } from '@/components/QueryInput/withDrag';
import ActiveSiderAgentBar, { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import useResourceCenterRouter from '@/layout/sider/components/useResourceCenterRouter';

interface Props {
  editable?: boolean;
  embedded?: boolean;
  // 嵌入右侧资源面板时仅展示中心跳转入口，不重复展示当前数字员工栏。
  showRouter?: boolean;
  style?: React.CSSProperties;
  onSelect?: (item: any, dragType: IDragType) => void;
  keyword?: string;
  agentId?: string;
  agentIds?: string;
}

const DataCenter: React.FC<Props> = (props) => {
  const { style, onSelect, editable = true, embedded = false, showRouter = false, keyword, agentId, agentIds } = props;
  const intl = useIntl();

  const activeSiderAgent = useActiveSiderAgent();
  const { isCenterPage: isKnowledgeCenterPage, toggleCenter } = useResourceCenterRouter(
    '/knowledgeCenter',
    'knowledge',
    showRouter,
    activeSiderAgent
  );

  return (
    <div style={style} className={styles.container}>
      {(!embedded || showRouter) && (
        <>
          {!embedded && <ActiveSiderAgentBar agent={activeSiderAgent} />}
          <div
            className={[styles.router, showRouter ? styles.routerSplit : ''].filter(Boolean).join(' ')}
            onClick={toggleCenter}
          >
            {showRouter && (
              <AntdIcon
                type={isKnowledgeCenterPage ? 'icon-a-Rightyou' : 'icon-a-Leftzuo'}
                className={styles.routerBackIcon}
              />
            )}
            <div className={styles.routerMain}>
              <span className={styles.middle}>{intl.formatMessage({ id: 'sider.knowledgeCenter' })}</span>
              <AntdIcon type="icon-zhishi" />
            </div>
            {!showRouter && (
              <AntdIcon
                type={isKnowledgeCenterPage ? 'icon-a-Leftzuo' : 'icon-a-Rightyou'}
                style={{ fontSize: 16, marginLeft: 'auto' }}
              />
            )}
          </div>
        </>
      )}
      <div className={styles.tabsWrapper}>
        <KnowledgeBaseTab
          editable={editable}
          onSelect={onSelect}
          keyword={keyword}
          agentId={agentId}
          agentIds={agentIds}
          activeAgentResourceId={activeSiderAgent.resourceId}
          detailInPanel={embedded}
        />
      </div>
    </div>
  );
};

export default DataCenter;
