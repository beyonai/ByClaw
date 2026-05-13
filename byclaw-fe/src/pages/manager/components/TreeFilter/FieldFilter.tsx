/* eslint-disable max-len */
import React from 'react';
import { useIntl } from '@umijs/max';
import TreeFilter, { type ITreeData } from './index';

import { buildCatalogTreeData } from './utils';

import { queryCatalogTree } from '@/pages/manager/service/OrgMgr';

function FieldFilter({ onOk, selectedList }: { onOk: (selectList: ITreeData[]) => void; selectedList?: ITreeData[] }) {
  const intl = useIntl();
  const [treeData, setTreeData] = React.useState<ITreeData[]>([]);

  React.useEffect(() => {
    queryCatalogTree({
      catalogType: 6, // 6 - 领域， 7- 要素
    }).then((res) => {
      if (Array.isArray(res?.data)) {
        setTreeData(buildCatalogTreeData(res.data));
      }
    });
  }, []);

  return (
    <TreeFilter
      title={intl.formatMessage({ id: 'businessField.filter.title' })}
      treeData={treeData}
      selectedList={selectedList}
      onOk={onOk}
    />
  );
}
export default FieldFilter;
