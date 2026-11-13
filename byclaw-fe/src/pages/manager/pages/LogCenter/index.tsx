import { CalendarOutlined, DownOutlined, SearchOutlined } from '@ant-design/icons';
import { isAdminVip } from '@/pages/manager/utils/auth';
import { useSelector } from '@umijs/max';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Form,
  Input,
  Popover,
  Select,
  Space,
  Table,
  Tooltip,
  Typography,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { searchLogs, type LogEntry, type LogPage, type LogSearch } from '../../service/LogCenter';
import styles from './index.less';
import { getTimePresets, MAX_RANGE_SECONDS, type TimeRange } from './timeRanges';

type Filters = Omit<LogSearch, 'from' | 'to' | 'pageToken' | 'pageSize'> & { range: [Dayjs, Dayjs] };

export default function LogCenter() {
  const userInfo = useSelector((state: any) => state.user.userInfo);
  const [form] = Form.useForm<Filters>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState<LogPage>();
  const [query, setQuery] = useState<LogSearch>();
  const [pageNumber, setPageNumber] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [pageRequests, setPageRequests] = useState<LogSearch[]>([]);
  const busy = useRef(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [alignHour, setAlignHour] = useState(false);
  const selectedRange = Form.useWatch('range', form) as TimeRange | undefined;
  const initialRange = useRef<TimeRange>([dayjs().subtract(1, 'hour'), dayjs()]);
  const displayedRange = selectedRange || initialRange.current;
  const initialQueryStarted = useRef(false);
  const canQuery = isAdminVip(userInfo);
  const tableViewport = useRef<HTMLDivElement>(null);
  const pageContainer = useRef<HTMLDivElement>(null);
  const resultsContainer = useRef<HTMLDivElement>(null);
  const paginationContainer = useRef<HTMLDivElement>(null);
  const [tableBodyHeight, setTableBodyHeight] = useState(200);

  useLayoutEffect(() => {
    const viewport = tableViewport.current;
    const container = pageContainer.current;
    const results = resultsContainer.current;
    const pagination = paginationContainer.current;
    if (!viewport || !container || !results || !pagination) return;
    const updateHeight = () => {
      const headerHeight = viewport.querySelector('thead')?.getBoundingClientRect().height || 55;
      const body = results.querySelector('.ant-card-body');
      const bodyStyle = body ? window.getComputedStyle(body) : null;
      const padding =
        Number.parseFloat(bodyStyle?.paddingTop || '24') + Number.parseFloat(bodyStyle?.paddingBottom || '24');
      const available = container.getBoundingClientRect().bottom - results.getBoundingClientRect().top - 24;
      setTableBodyHeight(
        Math.max(120, Math.floor(available - padding - headerHeight - pagination.getBoundingClientRect().height - 22))
      );
    };
    updateHeight();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateHeight);
      return () => window.removeEventListener('resize', updateHeight);
    }
    const observer = new ResizeObserver(updateHeight);
    observer.observe(container);
    observer.observe(pagination);
    if (container.firstElementChild) observer.observe(container.firstElementChild);
    return () => observer.disconnect();
  }, [canQuery]);

  const load = useCallback(async (request: LogSearch, targetPage = 1) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError('');
    try {
      const result = await searchLogs(request);
      setPage(result);
      setQuery(request);
      setPageNumber(targetPage);
      setPageSize(request.pageSize);
      setPageRequests((current) => [...current.slice(0, targetPage - 1), request]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure || '日志查询失败'));
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canQuery || initialQueryStarted.current) return;
    initialQueryStarted.current = true;
    const [from, to] = initialRange.current;
    void load({ from: from.unix(), to: to.unix(), pageSize: 10 });
  }, [canQuery, load]);

  const search = (values: Filters) => {
    const { range, ...filters } = values;
    const from = range[0].unix();
    const to = range[1].unix();
    if (to <= from || to - from > MAX_RANGE_SECONDS) {
      setError('结束时间必须晚于开始时间，查询范围不能超过24小时');
      return;
    }
    setPage(undefined);
    setQuery(undefined);
    setPageNumber(1);
    setPageRequests([]);
    void load({ ...filters, from, to, pageSize });
  };

  if (!canQuery) return <Alert type="warning" message="仅 adminvip 可查询日志" />;

  return (
    <div ref={pageContainer} className={styles.page}>
      <Card className={styles.filterCard}>
        <Form<Filters>
          form={form}
          layout="horizontal"
          labelCol={{ flex: '76px' }}
          wrapperCol={{ flex: 'auto' }}
          labelAlign="left"
          colon={false}
          disabled={loading}
          initialValues={{ range: initialRange.current }}
          onFinish={search}
        >
          <Form.Item name="range" hidden>
            <Input />
          </Form.Item>
          <div className={styles.filterHeader}>
            <div>
              <Typography.Title level={4} style={{ margin: '0 0 4px' }}>
                日志管理
              </Typography.Title>
              <Typography.Text type="secondary">检索与查看平台运行日志</Typography.Text>
            </div>
            <div className={styles.timeRangeField}>
              <label htmlFor="log-center-time-range" className={styles.timeRangeLabel}>
                时间范围
              </label>
              <Popover
                trigger="click"
                placement="bottomRight"
                open={timeOpen}
                onOpenChange={setTimeOpen}
                content={
                  <div className={styles.timePanel}>
                    <div className={styles.timePanelHeader}>
                      <Typography.Text strong>时间选择</Typography.Text>
                      <Checkbox checked={alignHour} onChange={(event) => setAlignHour(event.target.checked)}>
                        整点时间
                      </Checkbox>
                    </div>
                    <div className={styles.timePresets}>
                      {getTimePresets().map(({ label, range, disabled }) => (
                        <Tooltip key={label} title={disabled ? '当前单次查询最长支持24小时' : undefined}>
                          <span>
                            <Button
                              type="text"
                              disabled={loading || disabled}
                              onClick={() => {
                                const end = range[1].startOf('hour');
                                const start = range[0].startOf('hour');
                                const roundedRange = [start.isBefore(end) ? start : end.subtract(1, 'hour'), end];
                                form.setFieldValue('range', alignHour ? roundedRange : range);
                                setError('');
                                setTimeOpen(false);
                              }}
                            >
                              {label}
                            </Button>
                          </span>
                        </Tooltip>
                      ))}
                    </div>
                    <div className={styles.customTime}>
                      <Typography.Text strong>自定义时间</Typography.Text>
                      <DatePicker.RangePicker
                        showTime
                        allowClear={false}
                        className={styles.fullWidth}
                        value={displayedRange}
                        onChange={(range) => {
                          if (range?.[0] && range[1]) {
                            form.setFieldValue('range', range);
                            setError('');
                          }
                        }}
                      />
                      <Typography.Text type="secondary">单次查询最长24小时，结束时间不包含在范围内</Typography.Text>
                    </div>
                    <div className={styles.timeConfirm}>
                      <Button type="primary" onClick={() => setTimeOpen(false)}>
                        确认
                      </Button>
                    </div>
                  </div>
                }
              >
                <Button
                  aria-label="选择时间范围"
                  id="log-center-time-range"
                  disabled={loading}
                  className={styles.timeTrigger}
                  icon={<CalendarOutlined />}
                >
                  <span>
                    {displayedRange[0].format('YYYY-MM-DD HH:mm:ss')} ~{' '}
                    {displayedRange[1].format('YYYY-MM-DD HH:mm:ss')}
                  </span>
                  <DownOutlined />
                </Button>
              </Popover>
            </div>
          </div>
          <div className={styles.secondaryFilters}>
            <Form.Item name="moduleCode" label="模块编码" className={styles.instanceFilter} style={{ marginBottom: 0 }}>
              <Input placeholder="输入模块编码，留空查询全部模块" allowClear />
            </Form.Item>
            <Form.Item name="sandboxId" label="实例标识" className={styles.instanceFilter} style={{ marginBottom: 0 }}>
              <Input placeholder="输入实例标识，留空查询全部实例" allowClear />
            </Form.Item>
            <Form.Item name="level" label="日志级别" className={styles.levelFilter} style={{ marginBottom: 0 }}>
              <Select
                allowClear
                placeholder="全部级别"
                options={['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'].map((value) => ({ value }))}
              />
            </Form.Item>
          </div>
          <div className={styles.keywordRow}>
            <Form.Item name="keyword" label="关键词" className={styles.keywordFilter} style={{ marginBottom: 0 }}>
              <Input prefix={<SearchOutlined className={styles.searchIcon} />} placeholder="搜索日志内容" allowClear />
            </Form.Item>
            <Space className={styles.queryActions}>
              <Button
                onClick={() => {
                  form.resetFields();
                  setError('');
                  setPage(undefined);
                  setQuery(undefined);
                  setPageNumber(1);
                  setPageRequests([]);
                  setPageSize(10);
                }}
              >
                重置
              </Button>
              <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={loading}>
                查询
              </Button>
            </Space>
          </div>
        </Form>
      </Card>
      {error && <Alert type="error" message={error} showIcon />}
      {page?.limitReached && <Alert type="warning" message="已达到分页预算，请缩小时间范围后重新查询。" showIcon />}
      <Card ref={resultsContainer} className={styles.resultsCard}>
        <div ref={tableViewport} className={styles.tableViewport}>
          <Table<LogEntry>
            loading={loading}
            dataSource={(page?.items || []).map((entry, index) => ({ ...entry, key: String(index) }))}
            rowKey="key"
            pagination={false}
            scroll={{ x: 1000, y: tableBodyHeight }}
            locale={{ emptyText: '暂时没数据' }}
            expandable={{
              expandedRowRender: (entry) => (
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {JSON.stringify(entry.attributes, null, 2)}
                </pre>
              ),
            }}
            columns={[
              {
                title: '时间',
                dataIndex: 'timestamp',
                width: 190,
                render: (value) => dayjs.unix(value).format('YYYY-MM-DD HH:mm:ss'),
              },
              { title: '模块编码', dataIndex: ['attributes', 'moduleCode'], width: 160 },
              { title: '级别', dataIndex: 'level', width: 90 },
              { title: '来源', dataIndex: 'source', width: 180 },
              {
                title: '日志内容',
                dataIndex: 'message',
                render: (value) => <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value}</div>,
              },
            ]}
          />
        </div>
        <div ref={paginationContainer} className={styles.paginationFooter}>
          <Typography.Text type="secondary">
            第 {pageNumber} 页，本页 {page?.items.length || 0} 条
          </Typography.Text>
          <Space size="middle" wrap>
            <Space>
              <Button
                disabled={loading || pageNumber <= 1}
                onClick={() => void load(pageRequests[pageNumber - 2], pageNumber - 1)}
              >
                上一页
              </Button>
              <Button
                disabled={loading || !query || !page?.nextPageToken || page.limitReached}
                onClick={() => query && void load({ ...query, pageToken: page?.nextPageToken }, pageNumber + 1)}
              >
                下一页
              </Button>
            </Space>
            <Space>
              <Typography.Text type="secondary">每页条数</Typography.Text>
              <Select
                aria-label="每页条数"
                className={styles.pageSizeSelect}
                value={pageSize}
                disabled={loading}
                options={[10, 50, 100, 200].map((value) => ({ value, label: `${value} 条 / 页` }))}
                onChange={(size) => {
                  if (query) {
                    void load({ ...query, pageSize: size, pageToken: undefined });
                  } else {
                    setPageSize(size);
                  }
                }}
              />
            </Space>
          </Space>
        </div>
      </Card>
    </div>
  );
}
