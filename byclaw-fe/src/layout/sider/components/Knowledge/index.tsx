import React from 'react';
import { useIntl, useNavigate } from '@umijs/max';
import KnowledgeBaseTab from './components/KnowledgeBase';
import styles from './index.module.less';
import AntdIcon from '@/components/AntdIcon';
import { IDragType } from '@/components/QueryInput/withDrag';
import useGlobal from '@/hooks/useGlobal';
import { LayoutMode } from '@/constants/system';

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
  const intl = useIntl();

  const { layoutMode } = useGlobal();

  const isDebugMode = layoutMode === LayoutMode.debug;

  return (
    <div style={style} className={styles.container}>
      {!isDebugMode && (
        <div className={styles.router} onClick={() => navigate('/knowledgeCenter')}>
          <AntdIcon type="icon-a-Book-oneshuji11" />
          {/* <i className={classNames(styles.book, styles.icon, 'mr-6')} /> */}
          <span className={styles.middle}>{intl.formatMessage({ id: 'sider.knowledgeCenter' })}</span>
          {/* <AntdIcon type="icon-a-Arrow-rightjiantouyou2x" className={styles.right} /> */}
          <AntdIcon type="icon-a-Rightyou" style={{ fontSize: 16, marginLeft: 'auto' }} />
        </div>
      )}
      <KnowledgeBaseTab
        editable={editable}
        onSelect={onSelect}
        keyword={keyword}
        agentId={agentId}
        agentIds={agentIds}
      />
    </div>
  );
};

export default DataCenter;
