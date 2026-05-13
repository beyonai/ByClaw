import React, { useEffect } from 'react';
import { useDispatch } from '@umijs/max';

import { dataItemTypeMap } from './const';

import SelectModal, { IOrgCache as IIOrgCache } from './SelectModal';

type IProps = {
  open: boolean;
  onClose: () => void;
  selecteValue?: IIOrgCache[];
  onOK?: (val: IIOrgCache[]) => void;
};

export type IOrgCache = IIOrgCache;

function MyOrgSelect(props: IProps) {
  const { open, onClose, selecteValue = [], onOK } = props;

  const dispatch = useDispatch();

  const [dataList, setDataList] = React.useState<IIOrgCache[]>([]);
  const [selectList, setSelectList] = React.useState<IIOrgCache[]>(selecteValue);

  useEffect(() => {
    dispatch({
      type: 'user/queryMyDepartmentRange',
      payload: {},
    }).then((res) => {
      setDataList(() => {
        return res.map((item: any) => {
          return {
            ...item,
            id: `${dataItemTypeMap.org.toLowerCase()}_${item.orgId}`,
            name: item.orgName,
            type: dataItemTypeMap.org,
          };
        });
      });
    });
  }, []);

  useEffect(() => {
    setSelectList(selecteValue);
  }, [selecteValue]);

  return (
    <SelectModal
      open={open}
      onClose={onClose}
      onOK={onOK}
      dataList={dataList}
      selectList={selectList}
      setSelectList={setSelectList}
    />
  );
}

export default MyOrgSelect;
