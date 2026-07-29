import React, { useCallback } from 'react';
import { debounce } from 'lodash';
import { getSearchList } from '@/service/layout';
import type { HeaderSearchResult } from './types';

const defaultSearchResult: HeaderSearchResult = {
  digitList: [],
  userList: [],
  sessionList: [],
};

const useHeaderSearchResults = () => {
  const cancelTokenQKRef = React.useRef<AbortController>(new AbortController());
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [result, setResult] = React.useState<HeaderSearchResult>(defaultSearchResult);

  const myGetSearchList = useCallback(
    debounce((myKeyword: string) => {
      if (cancelTokenQKRef.current) {
        cancelTokenQKRef.current.abort();
      }

      cancelTokenQKRef.current = new AbortController();

      setIsLoading(true);

      getSearchList(
        {
          pageSize: 20,
          pageIndex: 1,
          type: 'all',
          keyword: myKeyword.trim(),
        },
        cancelTokenQKRef.current
      )
        .then((response) => {
          setResult(response);
          setIsLoading(false);
        })
        .catch((err) => {
          if (!err || err.name !== 'CanceledError') {
            setIsLoading(false);
          }
        });
    }, 300),
    []
  );

  const cancelSearch = useCallback(() => {
    myGetSearchList.cancel();
    cancelTokenQKRef.current?.abort();
    setIsLoading(false);
  }, [myGetSearchList]);

  return {
    isLoading,
    result,
    myGetSearchList,
    cancelSearch,
  };
};

export default useHeaderSearchResults;
