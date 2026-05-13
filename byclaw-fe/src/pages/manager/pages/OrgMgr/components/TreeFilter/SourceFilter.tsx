/* eslint-disable max-len */
import React from 'react';
import { useIntl } from '@umijs/max';
import TreeFilter, { type ITreeData } from './index';

import { buildTreeData } from './utils';

import { getSourceSystemList } from '@/pages/manager/service/OrgMgr';

type SourceSystemItem = {
  systemCode: string;
  systemName: string;
  poExternalSystemId?: number | null;
  [key: string]: any;
};

function SourceFilter({
  onOk,
  selectedList,
  sourceTypes,
  catalogIds,
  orgId,
}: {
  onOk: (selectList: ITreeData[]) => void;
  selectedList?: ITreeData[];
  sourceTypes?: string[];
  catalogIds?: string[];
  orgId?: string;
}) {
  const intl = useIntl();
  const [treeData, setTreeData] = React.useState<ITreeData[]>([]);

  React.useEffect(() => {
    getSourceSystemList({
      types: sourceTypes,
      catalogIds,
      orgId: orgId ? `${orgId}` : undefined,
    }).then((res) => {
      const list = Array.isArray(res) ? res : res?.data;
      if (Array.isArray(list)) {
        setTreeData(
          buildTreeData<SourceSystemItem>(list, {
            idField: 'systemCode',
            parentIdField: 'poExternalSystemId',
            labelField: 'systemName',
            rootParentId: null,
          })
        );
      }
    });
  }, [sourceTypes, catalogIds, orgId]);

  return (
    <TreeFilter
      title={intl.formatMessage({ id: 'filter.source' })}
      treeData={treeData}
      selectedList={selectedList}
      onOk={onOk}
    />
  );
}
export default SourceFilter;
