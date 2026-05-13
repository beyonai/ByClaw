import React from 'react';

// @ts-ignore
import { useSelector } from '@umijs/max';
import { size } from 'lodash';
import { getModelState } from '@/utils';

import { UserState } from '@/models/common/user';
import { ISessionState } from '@/models/session';
import { SessionType } from '@/constants/session';

interface ConnectState {
  session: ISessionState;
  user: UserState;
}

function useDialogue(props: { tabKey?: SessionType; getSearch: (tabKey: SessionType, searchKey?: string) => void }) {
  const { tabKey = SessionType.all, getSearch } = props;

  const [searchName, setSearchName] = React.useState('');

  const { sessionList, pagination } = useSelector((state: ConnectState) => state.session);

  const { list: currentList, pagination: currentPagination } = React.useMemo(() => {
    if (tabKey === SessionType.all) return { list: sessionList, pagination };

    return { list: [], pagination: { pageSize: 10, pageIndex: 0, total: 0 } };
  }, [tabKey, pagination, sessionList]);

  React.useEffect(() => {
    const { allLastSearchKeyword } = getModelState('session');

    let mySearchKey = '';

    if (tabKey === SessionType.all) {
      mySearchKey = allLastSearchKeyword;
    }

    setSearchName(mySearchKey);

    getSearch(tabKey, mySearchKey);
  }, [tabKey]);

  const { total } = currentPagination;
  const hasMore = total > size(currentList);

  return {
    currentList,
    currentPagination,
    hasMore,

    searchName,
    setSearchName,
  };
}

export default useDialogue;
