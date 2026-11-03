import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Select, Space, Spin, Tag } from 'antd';
import { history, useLocation } from '@umijs/max';
import { getEmployeeVersion, getEmployeeVersions, type EmployeeVersion } from '@/service/employeeVersions';
import { comparisonRows, changedText } from '@/components/EmployeeVersions/diff';
import { publicationErrorMessage } from '@/utils/publicationError';
import styles from './index.module.less';

function Highlight({ value, other, changed }: { value: string; other: string; changed: boolean }) {
  if (!changed) return <>{value}</>;
  const [prefix, difference, suffix] = changedText(value, other);
  return (
    <>
      {prefix}
      <mark>{difference}</mark>
      {suffix}
    </>
  );
}
export default function EmployeeVersionCompare() {
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const resourceId = query.get('resourceId') || '';
  const [leftId, setLeftId] = useState(query.get('left') || '');
  const [rightId, setRightId] = useState(query.get('right') || '');
  const [options, setOptions] = useState<EmployeeVersion[]>([]);
  const [listPage, setListPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const listGeneration = useRef(0);
  const [left, setLeft] = useState<EmployeeVersion>();
  const [right, setRight] = useState<EmployeeVersion>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    let disposed = false;
    listGeneration.current += 1;
    setOptions([]);
    setListPage(1);
    setHasMore(false);
    setLoadingMore(false);
    const load = async () => {
      try {
        const result = await getEmployeeVersions(resourceId);
        if (!disposed) {
          setOptions(result.versions);
          setHasMore(result.versions.length === 20);
        }
      } catch (e) {
        if (!disposed) setError(publicationErrorMessage(e, '版本列表加载失败'));
      }
    };
    if (resourceId) load();
    return () => {
      disposed = true;
      listGeneration.current += 1;
    };
  }, [resourceId, reload]);
  useEffect(() => {
    const current = ++generation.current;
    setBusy(true);
    setError('');
    setLeft(undefined);
    setRight(undefined);
    if (!resourceId || !leftId || !rightId) {
      setError('请选择同一数字员工的两个版本');
      setBusy(false);
      return;
    }
    Promise.all([getEmployeeVersion(resourceId, leftId), getEmployeeVersion(resourceId, rightId)])
      .then(([a, b]) => {
        if (current === generation.current) {
          setLeft(a);
          setRight(b);
        }
      })
      .catch((e) => {
        if (current === generation.current) setError(publicationErrorMessage(e, '版本详情加载失败'));
      })
      .finally(() => {
        if (current === generation.current) setBusy(false);
      });
    return () => {
      generation.current += 1;
    };
  }, [resourceId, leftId, rightId, reload]);
  const loadMore = async () => {
    const current = listGeneration.current;
    setLoadingMore(true);
    try {
      const result = await getEmployeeVersions(resourceId, listPage + 1);
      if (current === listGeneration.current) {
        setOptions((previous) => [...previous, ...result.versions]);
        setListPage((previous) => previous + 1);
        setHasMore(result.versions.length === 20);
      }
    } catch (e) {
      if (current === listGeneration.current) setError(publicationErrorMessage(e, '历史版本加载失败'));
    } finally {
      if (current === listGeneration.current) setLoadingMore(false);
    }
  };
  const versionOptions = Array.from(
    new Map([...options, ...[left, right].filter(Boolean)].map((v) => [v!.id, v!])).values()
  ).map((v) => ({ value: v.id, label: `V${v.number} · ${v.name}${v.active ? '（生效中）' : ''}` }));
  const rows = left && right ? comparisonRows(left.configuration || {}, right.configuration || {}) : [];
  const differences = rows.filter((row) => row.changed).length;
  return (
    <div className={styles.page}>
      <Space className={styles.toolbar}>
        <Button onClick={() => history.back()}>返回</Button>
        <h2>数字员工版本对比</h2>
        <Checkbox checked={onlyDifferences} onChange={(e) => setOnlyDifferences(e.target.checked)}>
          仅看差异
        </Checkbox>
        <span>{differences} 项差异</span>
        {hasMore && (
          <Button loading={loadingMore} onClick={loadMore}>
            加载更早版本
          </Button>
        )}
      </Space>
      <Alert
        type="info"
        showIcon
        message="比较保存时的配置。权限、发布范围、凭证及用户私有记忆不参与版本切换；关联技能、工具与知识的内容不会随员工版本回退。"
      />
      {error && (
        <Alert type="error" message={error} action={<Button onClick={() => setReload(reload + 1)}>重试</Button>} />
      )}
      <div className={styles.selectors}>
        <div>
          <label>左侧版本</label>
          <Select
            showSearch
            optionFilterProp="label"
            aria-label="左侧版本"
            value={leftId || undefined}
            options={versionOptions}
            onChange={setLeftId}
          />
          <span>
            {left?.createdAt} · 保存人 {left?.authorId}
          </span>
        </div>
        <div>
          <label>右侧版本</label>
          <Select
            showSearch
            optionFilterProp="label"
            aria-label="右侧版本"
            value={rightId || undefined}
            options={versionOptions}
            onChange={setRightId}
          />
          <span>
            {right?.createdAt} · 保存人 {right?.authorId}
          </span>
        </div>
      </div>
      <Spin spinning={busy}>
        {left && right && !differences && <Alert type="success" message="两个版本的配置内容相同" />}
        {rows
          .filter((row) => !onlyDifferences || row.changed)
          .map((row) => (
            <div key={row.key} className={`${styles.row} ${row.changed ? styles.changed : ''}`}>
              <div className={styles.label}>
                {row.label}{' '}
                {row.changed && (
                  <Tag color={row.kind === 'removed' ? 'red' : row.kind === 'added' ? 'green' : 'orange'}>
                    {row.kind === 'removed' ? '删除' : row.kind === 'added' ? '新增' : '修改'}
                  </Tag>
                )}
              </div>
              <div className={styles.details}>
                <pre>
                  <Highlight value={row.before} other={row.after} changed={row.changed} />
                </pre>
                <pre>
                  <Highlight value={row.after} other={row.before} changed={row.changed} />
                </pre>
              </div>
            </div>
          ))}
      </Spin>
    </div>
  );
}
