import { useEffect, useMemo, useState } from 'react';

export default function useAuditSearch<T extends { resourceName?: string | null }>(rows: T[]) {
  const [auditKeyword, setAuditKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');

  useEffect(() => {
    // 审核接口返回完整列表，输入停止后再过滤缓存，避免每次按键都更新表格。
    const timer = window.setTimeout(() => setDebouncedKeyword(auditKeyword.trim().toLowerCase()), 300);
    return () => window.clearTimeout(timer);
  }, [auditKeyword]);

  const filteredRows = useMemo(
    () =>
      debouncedKeyword ? rows.filter((row) => (row.resourceName || '').toLowerCase().includes(debouncedKeyword)) : rows,
    [rows, debouncedKeyword]
  );

  return { auditKeyword, setAuditKeyword, filteredRows };
}
