import React, { useCallback, useEffect, useState } from 'react';
import { DragType, IDragType } from '@/components/QueryInput/withDrag';
import { IDatabaseItem, ITreeItem } from './types';
import DatabaseList from './DatabaseList';
import DatabaseDetail from './DatabaseDetail';
import styles from './index.module.less';
import useKnowledge from '@/hooks/useKnowledge';

interface Props {
  editable?: boolean;
  onSelect?: (node: string | IDatabaseItem, type: IDragType) => void;
}

const DatabaseTab = (props: Props) => {
  const { editable, onSelect } = props;
  const { selectedKnowledgeInfo } = useKnowledge({ setDefaultSelected: false });
  const [currentDatabase, setCurrentDatabase] = useState<IDatabaseItem | null>(selectedKnowledgeInfo);

  useEffect(() => {
    if (selectedKnowledgeInfo) {
      setCurrentDatabase(selectedKnowledgeInfo);
    }
  }, [selectedKnowledgeInfo]);

  // 进入数据库详情
  const handleEnterDatabase = useCallback((db: IDatabaseItem) => {
    setCurrentDatabase(db);
  }, []);

  // 返回列表
  const handleGoBack = useCallback(() => {
    setCurrentDatabase(null);
    // 不需要重新加载列表，保持原有状态
  }, []);

  const onSelectDb = useCallback(
    (db: IDatabaseItem) => {
      onSelect?.(db, DragType.database);
    },
    [onSelect]
  );

  const onSelectFieldItem = useCallback(
    (item: ITreeItem) => {
      onSelect?.(item.title, DragType.text);
    },
    [onSelect]
  );

  return (
    <>
      <div className={styles.databaseTab} style={{ display: currentDatabase ? 'none' : 'block' }}>
        <DatabaseList onDrilldown={handleEnterDatabase} onSelect={onSelectDb} />
      </div>

      {currentDatabase && (
        <div className={styles.databaseTab}>
          <DatabaseDetail
            key={currentDatabase.knowledgeBaseId}
            editable={editable}
            knowledge={currentDatabase}
            onGoBack={handleGoBack}
            onSelect={onSelectFieldItem}
          />
        </div>
      )}
    </>
  );
};

export default DatabaseTab;
