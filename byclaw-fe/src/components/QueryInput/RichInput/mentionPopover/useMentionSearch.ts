import { useEffect, useMemo, useState } from 'react';

interface UseMentionSearchProps<T> {
  fetchData: () => Promise<T[]>;
  searchKey: keyof T;
}

function useMentionSearch<T>({ fetchData, searchKey }: UseMentionSearchProps<T>) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    fetchData()
      .then((res) => setData(res))
      .finally(() => setLoading(false));
  }, [fetchData]);

  const filteredData = useMemo(() => {
    if (!search) return data;
    return data.filter((item) => {
      const value = item[searchKey];
      if (typeof value === 'string') {
        return value.includes(search);
      }
      return false;
    });
  }, [data, search, searchKey]);

  return {
    data,
    filteredData,
    loading,
    search,
    setSearch,
  };
}

export default useMentionSearch;
