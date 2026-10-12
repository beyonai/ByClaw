import { useEffect, useMemo, useState } from 'react';

export default function useAuditSearch<T extends { resourceName?: string | null }>(rows: T[]) {
  const [auditKeyword, setAuditKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');

  useEffect(() => {
    // 输入停止后再更新关键词，供本地筛选或服务端查询共用，避免每次按键都更新列表。
    const timer = window.setTimeout(() => setDebouncedKeyword(auditKeyword.trim().toLowerCase()), 300);
    return () => window.clearTimeout(timer);
  }, [auditKeyword]);

  const filteredRows = useMemo(
    () =>
      debouncedKeyword ? rows.filter((row) => (row.resourceName || '').toLowerCase().includes(debouncedKeyword)) : rows,
    [rows, debouncedKeyword]
  );

  return { auditKeyword, setAuditKeyword, debouncedKeyword, filteredRows };
}
