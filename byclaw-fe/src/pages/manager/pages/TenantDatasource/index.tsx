import { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from '@umijs/max';
import { Alert, Button, Empty, Input, message, Modal, Select, Spin, Table, Tag, Tooltip } from 'antd';
import {
  CaretDownOutlined,
  CaretRightOutlined,
  CloseOutlined,
  CodeOutlined,
  DatabaseOutlined,
  FolderOpenOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { listTenants, type TenantItem } from '../../service/TenantMgr';
import {
  browseTenantTable,
  executeTenantSql,
  listTenantTables,
  type TenantQueryResult,
  type TenantTable,
} from '../../service/TenantDatasource';
import styles from './index.module.less';
import { requiresSqlConfirmation } from './sqlSafety';

interface TableTab {
  key: string;
  table: TenantTable;
  page: number;
  result?: TenantQueryResult;
  elapsed?: number;
  loading: boolean;
}

const SQL_TAB = 'sql';
const PAGE_SIZE = 500;
const tableKey = (table: TenantTable) => `table:${table.schema}.${table.name}`;
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

function ResultGrid({ result, loading }: { result?: TenantQueryResult; loading?: boolean }) {
  if (loading) return <Spin className={styles.resultLoading} />;
  if (!result) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="查询结果将在这里显示" />;
  if (!result.columns.length) {
    return <div className={styles.success}>执行成功，影响 {result.affectedRows} 行。</div>;
  }
  return (
    <Table
      size="small"
      bordered
      rowKey="key"
      pagination={false}
      scroll={{ x: 'max-content', y: 420 }}
      columns={result.columns.map((column, index) => ({
        title: <Tooltip title={column.type}>{column.name}</Tooltip>,
        key: `${column.name}-${index}`,
        dataIndex: ['values', index],
        render: (value: string | null) => (value === null ? <i className={styles.null}>NULL</i> : value),
      }))}
      dataSource={result.rows.map((values, key) => ({ key, values }))}
    />
  );
}

export default function TenantDatasource() {
  const userInfo = useSelector(({ user }: any) => user.userInfo);
  const isPlatformAdmin = (userInfo?.usersOrganizations || []).some((org: any) => org.userType === 'PLAT_MAN');
  const requestEpoch = useRef(0);
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [tenantId, setTenantId] = useState<string>();
  const [tables, setTables] = useState<TenantTable[]>([]);
  const [tableFilter, setTableFilter] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedTableKey, setSelectedTableKey] = useState<string>();
  const [openTables, setOpenTables] = useState<TableTab[]>([]);
  const [activeTab, setActiveTab] = useState(SQL_TAB);
  const [sql, setSql] = useState('');
  const [executedSql, setExecutedSql] = useState('');
  const [sqlResult, setSqlResult] = useState<TenantQueryResult>();
  const [sqlElapsed, setSqlElapsed] = useState<number>();
  const [loadingTables, setLoadingTables] = useState(false);
  const [runningSql, setRunningSql] = useState(false);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    listTenants()
      .then((items) => setTenants(Array.isArray(items) ? items : []))
      .catch(() => setTenants([]));
  }, [isPlatformAdmin]);

  const readyTenants = useMemo(() => tenants.filter((item) => item.provisionState === 'READY'), [tenants]);
  const selectedTenant = tenants.find((item) => item.enterpriseId === tenantId);
  const selectedTab = openTables.find((tab) => tab.key === activeTab);
  const selectedTable = tables.find((table) => tableKey(table) === selectedTableKey);
  const schemas = useMemo(() => {
    const filter = tableFilter.trim().toLowerCase();
    const groups = new Map<string, TenantTable[]>();
    tables.forEach((table) => {
      if (filter && !`${table.schema}.${table.name}`.toLowerCase().includes(filter)) return;
      groups.set(table.schema, [...(groups.get(table.schema) || []), table]);
    });
    return [...groups.entries()];
  }, [tables, tableFilter]);

  const connect = async (nextTenantId: string) => {
    const epoch = ++requestEpoch.current;
    setTenantId(nextTenantId);
    setTables([]);
    setSelectedTableKey(undefined);
    setOpenTables([]);
    setActiveTab(SQL_TAB);
    setSqlResult(undefined);
    setSql('');
    setExecutedSql('');
    setExpanded({ connection: true, 'schema:byai': true });
    setLoadingTables(true);
    try {
      const items = await listTenantTables(nextTenantId);
      if (requestEpoch.current === epoch) setTables(Array.isArray(items) ? items : []);
    } catch {
      if (requestEpoch.current === epoch) setTables([]);
    } finally {
      if (requestEpoch.current === epoch) setLoadingTables(false);
    }
  };

  const loadTable = async (table: TenantTable, nextPage: number) => {
    if (!tenantId) return;
    const key = tableKey(table);
    const epoch = requestEpoch.current;
    const currentTenant = tenantId;
    setOpenTables((current) => current.map((tab) => (tab.key === key ? { ...tab, loading: true } : tab)));
    const started = performance.now();
    try {
      const result = await browseTenantTable(currentTenant, table.schema, table.name, nextPage);
      if (requestEpoch.current !== epoch) return;
      setOpenTables((current) =>
        current.map((tab) =>
          tab.key === key
            ? { ...tab, page: nextPage, result, elapsed: performance.now() - started, loading: false }
            : tab
        )
      );
    } catch {
      if (requestEpoch.current !== epoch) return;
      setOpenTables((current) => current.map((tab) => (tab.key === key ? { ...tab, loading: false } : tab)));
      message.error('数据表加载失败');
    }
  };

  const openTable = (table: TenantTable) => {
    const key = tableKey(table);
    setSelectedTableKey(key);
    setActiveTab(key);
    if (openTables.some((tab) => tab.key === key)) return;
    setOpenTables((current) => [...current, { key, table, page: 1, loading: false }]);
    void loadTable(table, 1);
  };

  const closeTable = (key: string) => {
    setOpenTables((current) => current.filter((tab) => tab.key !== key));
    if (activeTab === key) setActiveTab(SQL_TAB);
  };

  const runSql = async () => {
    if (!tenantId || !sql.trim()) return;
    const statementSql = sql.trim();
    const currentTenant = tenantId;
    const dangerous = requiresSqlConfirmation(statementSql);
    const epoch = requestEpoch.current;
    const execute = async () => {
      if (requestEpoch.current !== epoch) return;
      setRunningSql(true);
      const started = performance.now();
      try {
        const result = await executeTenantSql(currentTenant, statementSql, 1, dangerous);
        if (requestEpoch.current !== epoch) return;
        setSqlResult(result);
        setExecutedSql(statementSql);
        setSqlElapsed(performance.now() - started);
        message.success('SQL 执行成功');
      } catch {
        message.error('SQL 执行失败');
      } finally {
        if (requestEpoch.current === epoch) setRunningSql(false);
      }
    };
    if (!dangerous) {
      await execute();
      return;
    }
    Modal.confirm({
      title: '确认执行高危 SQL？',
      content: (
        <div>
          <p>以下操作可能修改或删除「{selectedTenant?.enterpriseName || currentTenant}」的数据，执行后可能无法撤销。</p>
          <pre className={styles.confirmSql}>{statementSql}</pre>
        </div>
      ),
      okText: '确认执行',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: execute,
    });
  };

  const loadSqlPage = async (page: number) => {
    if (!tenantId || !executedSql) return;
    const epoch = requestEpoch.current;
    setRunningSql(true);
    const started = performance.now();
    try {
      const result = await executeTenantSql(tenantId, executedSql, page, false);
      if (requestEpoch.current !== epoch) return;
      setSqlResult(result);
      setSqlElapsed(performance.now() - started);
    } catch {
      message.error('查询结果加载失败');
    } finally {
      if (requestEpoch.current === epoch) setRunningSql(false);
    }
  };

  if (!isPlatformAdmin) return <Alert type="warning" message="仅平台管理员可访问租户数据源。" />;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>TENANT DATABASE</div>
          <h1>租户数据源</h1>
          <p>展开对象树浏览数据表，双击表名打开数据；SQL 查询在独立标签中运行。</p>
        </div>
        <div className={styles.connection}>
          <DatabaseOutlined />
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="选择已开通的租户"
            value={tenantId}
            onChange={(value) => void connect(value)}
            options={readyTenants.map((tenant) => ({
              label: `${tenant.enterpriseName} · ${tenant.enterpriseId}`,
              value: tenant.enterpriseId,
            }))}
            style={{ width: 280 }}
          />
          {tenantId && (
            <Tooltip title="刷新对象树">
              <Button icon={<ReloadOutlined />} loading={loadingTables} onClick={() => void connect(tenantId)} />
            </Tooltip>
          )}
        </div>
      </header>

      <div className={styles.workbench}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarTitle}>
            <DatabaseOutlined />
            <span>数据库对象</span>
            <Tag>{tables.length}</Tag>
          </div>
          <Input.Search
            allowClear
            placeholder="搜索 schema / 表名"
            value={tableFilter}
            onChange={(event) => setTableFilter(event.target.value)}
          />
          <div className={styles.objectTree} role="tree" aria-label="租户数据库对象">
            {loadingTables ? (
              <Spin className={styles.tableLoading} />
            ) : !tenantId ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择租户" />
            ) : (
              <>
                <button
                  type="button"
                  role="treeitem"
                  aria-expanded={expanded.connection !== false}
                  className={styles.treeFolder}
                  onClick={() => setExpanded((current) => ({ ...current, connection: current.connection === false }))}
                >
                  {expanded.connection === false ? <CaretRightOutlined /> : <CaretDownOutlined />}
                  <DatabaseOutlined />
                  <span title={selectedTenant?.enterpriseName}>{selectedTenant?.enterpriseName || tenantId}</span>
                </button>
                {expanded.connection !== false &&
                  (schemas.length ? (
                    schemas.map(([schema, schemaTables]) => {
                      const folderKey = `schema:${schema}`;
                      const isOpen = Boolean(tableFilter) || expanded[folderKey] !== false;
                      return (
                        <div key={schema} role="group">
                          <button
                            type="button"
                            role="treeitem"
                            aria-expanded={isOpen}
                            className={styles.treeFolder}
                            style={{ paddingLeft: 25 }}
                            onClick={() => setExpanded((current) => ({ ...current, [folderKey]: !isOpen }))}
                          >
                            {isOpen ? <CaretDownOutlined /> : <CaretRightOutlined />}
                            <FolderOpenOutlined />
                            <span>{schema}</span>
                            <small>{schemaTables.length}</small>
                          </button>
                          {isOpen && (
                            <div role="group">
                              {schemaTables.map((table) => {
                                const key = tableKey(table);
                                return (
                                  <button
                                    type="button"
                                    role="treeitem"
                                    aria-selected={selectedTableKey === key}
                                    key={key}
                                    className={selectedTableKey === key ? styles.treeTableSelected : styles.treeTable}
                                    title={`${table.schema}.${table.name} · 双击打开`}
                                    onClick={() => setSelectedTableKey(key)}
                                    onDoubleClick={() => openTable(table)}
                                  >
                                    <TableOutlined />
                                    <span>{table.name}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据表" />
                  ))}
              </>
            )}
          </div>
          {selectedTable && (
            <Button
              size="small"
              icon={<CodeOutlined />}
              onClick={() => {
                setSql(`SELECT * FROM ${quote(selectedTable.schema)}.${quote(selectedTable.name)} LIMIT ${PAGE_SIZE};`);
                setSqlResult(undefined);
                setExecutedSql('');
                setActiveTab(SQL_TAB);
              }}
            >
              在 SQL 查询中打开
            </Button>
          )}
          <div className={styles.treeHint}>单击选中，双击表名打开数据</div>
        </aside>

        <section className={styles.main}>
          <div className={styles.tabBar} role="tablist" aria-label="数据库工作标签">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === SQL_TAB}
              className={activeTab === SQL_TAB ? styles.tabActive : styles.tab}
              onClick={() => setActiveTab(SQL_TAB)}
            >
              <CodeOutlined /> SQL 查询
            </button>
            {openTables.map((tab) => (
              <div key={tab.key} className={activeTab === tab.key ? styles.tabActive : styles.tab}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.key}
                  title={`${tab.table.schema}.${tab.table.name}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  <TableOutlined /> {tab.table.name}
                </button>
                <button
                  type="button"
                  className={styles.closeTab}
                  aria-label={`关闭 ${tab.table.name}`}
                  onClick={() => closeTable(tab.key)}
                >
                  <CloseOutlined />
                </button>
              </div>
            ))}
            {activeTab !== SQL_TAB && (
              <Tooltip title="新建 SQL 查询">
                <button type="button" className={styles.newQuery} onClick={() => setActiveTab(SQL_TAB)}>
                  <PlusOutlined />
                </button>
              </Tooltip>
            )}
          </div>

          {activeTab === SQL_TAB ? (
            <>
              <div className={styles.editorHeader}>
                <span>
                  <CodeOutlined /> SQL 编辑器
                </span>
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  disabled={!tenantId || !sql.trim()}
                  loading={runningSql}
                  onClick={() => void runSql()}
                >
                  运行 SQL
                </Button>
              </div>
              <Input.TextArea
                className={styles.editor}
                value={sql}
                onChange={(event) => {
                  setSql(event.target.value);
                  setSqlResult(undefined);
                  setExecutedSql('');
                }}
                placeholder="输入一条 SQL 语句…"
                spellCheck={false}
                rows={7}
              />
              <div className={styles.resultHeader}>
                <strong>查询结果</strong>
                {sqlResult && (
                  <span>
                    {sqlResult.columns.length
                      ? `第 ${sqlResult.page} 页 · ${sqlResult.rows.length} 行`
                      : `影响 ${sqlResult.affectedRows} 行`}
                    {sqlElapsed !== undefined ? ` · ${Math.round(sqlElapsed)} ms` : ''}
                  </span>
                )}
              </div>
              <div className={styles.result}>
                <ResultGrid result={sqlResult} loading={runningSql} />
                {sqlResult?.truncated && <Alert type="warning" message="结果已截断，仅显示前 500 行。" />}
                {sqlResult && sqlResult.columns.length > 0 && !sqlResult.truncated && (
                  <div className={styles.pager}>
                    <Button
                      disabled={sqlResult.page <= 1 || runningSql}
                      onClick={() => void loadSqlPage(sqlResult.page - 1)}
                    >
                      上一页
                    </Button>
                    <span>每页最多 {PAGE_SIZE} 行</span>
                    <Button
                      disabled={!sqlResult.hasNextPage || runningSql}
                      onClick={() => void loadSqlPage(sqlResult.page + 1)}
                    >
                      下一页
                    </Button>
                  </div>
                )}
              </div>
            </>
          ) : selectedTab ? (
            <>
              <div className={styles.editorHeader}>
                <span>
                  <TableOutlined /> {selectedTab.table.schema}.{selectedTab.table.name}
                </span>
                <Button
                  icon={<ReloadOutlined />}
                  loading={selectedTab.loading}
                  onClick={() => void loadTable(selectedTab.table, selectedTab.page)}
                >
                  刷新数据
                </Button>
              </div>
              <div className={styles.resultHeader}>
                <strong>表数据</strong>
                {selectedTab.result && (
                  <span>
                    {selectedTab.result.rows.length} 行
                    {selectedTab.elapsed !== undefined ? ` · ${Math.round(selectedTab.elapsed)} ms` : ''}
                  </span>
                )}
              </div>
              <div className={styles.result}>
                <ResultGrid result={selectedTab.result} loading={selectedTab.loading} />
                {selectedTab.result && (
                  <div className={styles.pager}>
                    <Button
                      disabled={selectedTab.page <= 1 || selectedTab.loading}
                      onClick={() => void loadTable(selectedTab.table, selectedTab.page - 1)}
                    >
                      上一页
                    </Button>
                    <span>
                      第 {selectedTab.page} 页 · 每页最多 {PAGE_SIZE} 行
                    </span>
                    <Button
                      disabled={!selectedTab.result.hasNextPage || selectedTab.loading}
                      onClick={() => void loadTable(selectedTab.table, selectedTab.page + 1)}
                    >
                      下一页
                    </Button>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
