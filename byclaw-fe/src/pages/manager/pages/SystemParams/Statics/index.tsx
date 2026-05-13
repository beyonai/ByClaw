import React, { useEffect } from 'react';
import classNames from 'classnames';
import { CopyOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import copy from 'copy-to-clipboard';
import { trim, debounce } from 'lodash';
import JSONPretty from 'react-json-prettify';
import { github as jsonGithubTheme } from 'react-json-prettify/dist/themes';
import { message, Table, Button, Typography, Input, Space, Popconfirm, Drawer, Alert } from 'antd';
import { useIntl } from '@umijs/max';
import {
  selectSystemConfigListByQo,
  deleteByParamGroupCode,
  clearOneByParamGroupCode,
  clearAllSystemConfigListCache,
} from '@/pages/manager/service/System';
import StaticsDrawer from './StaticsDrawer';

import styles from './index.module.less';

function isJsonPrettyCompatible(value: unknown): value is Record<string, unknown> | unknown[] | null {
  if (value === null) {
    return true;
  }
  if (Array.isArray(value)) {
    return true;
  }
  return typeof value === 'object';
}

type SystemParamsItem = {
  paramGroupCode: string;
  paramGroupName: string;
  cacheJson: string;
};

export default function SystemParamsStatics() {
  const intl = useIntl();
  const [pageInfo, setPageInfo] = React.useState({ pageIndex: 1, pageSize: 20, total: 0, totalPage: 0 });
  const [keyword, setKeyword] = React.useState('');
  const [list, setList] = React.useState<SystemParamsItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [editItem, setEditItem] = React.useState<SystemParamsItem | null>(null);
  const [createModalOpen, setCreateModalOpen] = React.useState(false);

  const [clearAllSystemConfigCacheLoading, setClearAllSystemConfigCacheLoading] = React.useState(false);

  const [jsonViewerOpen, setJsonViewerOpen] = React.useState(false);
  const [jsonViewerRecord, setJsonViewerRecord] = React.useState<SystemParamsItem | null>(null);

  const curParam = React.useRef<{ pageIndex?: number; pageSize?: number; keyword?: string }>({});

  const mySelectSystemConfigListByQo = React.useCallback(
    (myPageInfo: { pageIndex: number; pageSize: number }, keyword?: string) => {
      setIsLoading(true);

      const p = {
        pageIndex: myPageInfo.pageIndex,
        pageSize: myPageInfo.pageSize,
        keyword,
      };

      curParam.current = p;

      return selectSystemConfigListByQo(p)
        .then((data: any) => {
          const { list, ...restPageInfo } = data || {};

          setList(list);

          setPageInfo((prevState) => {
            return {
              ...prevState,
              ...restPageInfo,
            };
          });
        })
        .finally(() => {
          setIsLoading(false);
        });
    },
    []
  );

  const openJsonViewer = React.useCallback((record: SystemParamsItem) => {
    setJsonViewerRecord(record);
    setJsonViewerOpen(true);
  }, []);

  const columns = React.useMemo(() => {
    return [
      {
        title: intl.formatMessage({ id: 'SystemParams.params.name' }),
        dataIndex: 'paramGroupName',
        width: 250,
        align: 'left' as const,
        render: (value: string) => {
          return (
            <Typography.Paragraph
              ellipsis={{
                rows: 3,
                expandable: true,
                symbol: (
                  <span style={{ color: '#999' }}>{intl.formatMessage({ id: 'SystemParams.common.viewMore' })}</span>
                ),
              }}
              style={{ lineHeight: '24px', textAlign: 'left' }}
            >
              {value}
            </Typography.Paragraph>
          );
        },
      },
      {
        title: intl.formatMessage({ id: 'SystemParams.params.code' }),
        dataIndex: 'paramGroupCode',
        width: 300,
        align: 'left' as const,
        render: (value: string) => {
          return (
            <Typography.Paragraph
              copyable={{
                icon: [<CopyOutlined key="paramGroupCode_copy" style={{ color: '#999' }} />],
              }}
              style={{ textAlign: 'left' }}
            >
              {value}
            </Typography.Paragraph>
          );
        },
      },
      {
        title: intl.formatMessage({ id: 'SystemParams.statics.jsonData' }),
        dataIndex: 'cacheJson',
        align: 'left' as const,
        render: (value: string, record: SystemParamsItem) => {
          return (
            <Typography.Paragraph
              ellipsis={{
                rows: 3,
                expandable: true,
                expanded: false,
                symbol: (
                  <span style={{ color: '#999' }}>{intl.formatMessage({ id: 'SystemParams.common.viewMore' })}</span>
                ),
                onExpand: () => {
                  openJsonViewer(record);
                },
              }}
              copyable={
                value
                  ? {
                    icon: [<CopyOutlined key="cacheJson_copy" style={{ color: '#999' }} />],
                  }
                  : false
              }
              style={{ lineHeight: '24px', textAlign: 'left' }}
            >
              {value}
            </Typography.Paragraph>
          );
        },
      },
      {
        title: intl.formatMessage({ id: 'SystemParams.params.action' }),
        dataIndex: 'action',
        width: 260,
        align: 'left' as const,
        render: (_: any, record: SystemParamsItem) => {
          return (
            <Space size="small">
              <Button
                size="small"
                type="link"
                onClick={() => {
                  setIsLoading(true);
                  clearOneByParamGroupCode({
                    paramGroupCode: record.paramGroupCode,
                  })
                    .then((res: any) => {
                      if (`${res?.code}` === '0') {
                        message.success(res.msg);
                      } else {
                        message.error(res?.msg);
                      }
                    })
                    .finally(() => {
                      setIsLoading(false);
                    });
                }}
              >
                {intl.formatMessage({ id: 'SystemParams.params.refreshData' })}
              </Button>
              <Button
                size="small"
                type="link"
                onClick={() => {
                  setEditItem(record);
                  setCreateModalOpen(true);
                }}
              >
                {intl.formatMessage({ id: 'SystemParams.params.edit' })}
              </Button>
              <Popconfirm
                title={intl.formatMessage({ id: 'SystemParams.params.deleteConfirm' })}
                onConfirm={() => {
                  setIsLoading(true);
                  deleteByParamGroupCode({
                    paramGroupCode: record.paramGroupCode,
                  })
                    .then((res: any) => {
                      if (`${res?.code}` === '0') {
                        message.success(res.msg);
                        mySelectSystemConfigListByQo(
                          {
                            pageIndex: curParam.current?.pageIndex || pageInfo.pageIndex,
                            pageSize: curParam.current?.pageSize || pageInfo.pageSize,
                          },
                          curParam.current?.keyword
                        );
                      } else {
                        message.error(res?.msg);
                      }
                    })
                    .finally(() => {
                      setIsLoading(false);
                    });
                }}
              >
                <Button size="small" type="link" danger>
                  {intl.formatMessage({ id: 'SystemParams.params.delete' })}
                </Button>
              </Popconfirm>
            </Space>
          );
        },
      },
    ];
  }, [intl, openJsonViewer, pageInfo, mySelectSystemConfigListByQo]);

  const jsonDrawerBody = React.useMemo(() => {
    if (!jsonViewerRecord?.cacheJson) {
      return <Typography.Text type="secondary">—</Typography.Text>;
    }
    const raw = jsonViewerRecord.cacheJson;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      return (
        <>
          <Alert
            type="warning"
            showIcon
            message={intl.formatMessage({ id: 'SystemParams.statics.jsonInvalid' })}
            style={{ marginBottom: 12 }}
          />
          <pre className={styles.jsonDrawerPre}>{raw}</pre>
        </>
      );
    }
    if (isJsonPrettyCompatible(parsed)) {
      return (
        <div className={styles.jsonDrawerScroll}>
          <JSONPretty json={parsed as any} theme={jsonGithubTheme} padding={12} />
        </div>
      );
    }
    return <pre className={styles.jsonDrawerPre}>{JSON.stringify(parsed, null, 2)}</pre>;
  }, [intl, jsonViewerRecord]);

  useEffect(() => {
    mySelectSystemConfigListByQo(pageInfo, keyword);
  }, []);

  const clearAllSystemConfigCacheDebounce = React.useCallback(
    debounce(() => {
      setClearAllSystemConfigCacheLoading(true);
      clearAllSystemConfigListCache()
        .then((res: any) => {
          if (`${res?.code}` === '0') {
            message.success(res?.msg);
          } else {
            message.error(res?.msg);
          }
        })
        .finally(() => {
          setClearAllSystemConfigCacheLoading(false);
        });
    }, 500),
    []
  );

  return (
    <>
      <div className={classNames('full-height ub ub-ver gap8', styles.container)}>
        <div className={'ub ub-ac gap8'} style={{ justifyContent: 'end' }}>
          <Input.Search
            placeholder={intl.formatMessage({ id: 'SystemParams.params.keywordPlaceholder' })}
            value={keyword}
            onChange={(e) => {
              setKeyword(trim(e.target.value));
            }}
            onSearch={() => {
              mySelectSystemConfigListByQo(
                {
                  ...pageInfo,
                  pageIndex: 1,
                },
                keyword
              );
            }}
            onPressEnter={() => {
              mySelectSystemConfigListByQo(
                {
                  ...pageInfo,
                  pageIndex: 1,
                },
                keyword
              );
            }}
            style={{ width: 500 }}
            allowClear
          />
          <Button
            type="primary"
            icon={<PlusOutlined size={16} />}
            onClick={() => {
              setEditItem(null);
              setCreateModalOpen(true);
            }}
          >
            {intl.formatMessage({ id: 'SystemParams.params.add' })}
          </Button>
          <Button
            icon={<ReloadOutlined size={16} />}
            type="primary"
            onClick={clearAllSystemConfigCacheDebounce}
            loading={clearAllSystemConfigCacheLoading}
          >
            {intl.formatMessage({ id: 'SystemParams.params.refreshAll' })}
          </Button>
        </div>
        <div className={classNames('ub-f1', styles.tableScroll)}>
          <Table<SystemParamsItem>
            tableLayout="fixed"
            rowKey="paramGroupCode"
            columns={columns}
            dataSource={list}
            pagination={{
              ...pageInfo,
              current: pageInfo.pageIndex,
              showTotal: (total: number) => intl.formatMessage({ id: 'SystemParams.pagination.total' }, { total }),
              onChange: (pageIndex: number, pageSize: number) => {
                setPageInfo((prevState) => {
                  return {
                    ...prevState,
                    pageIndex,
                    pageSize,
                  };
                });
                mySelectSystemConfigListByQo(
                  {
                    ...pageInfo,
                    pageIndex,
                    pageSize,
                  },
                  keyword
                );
              },
            }}
            scroll={{ y: 'calc(100vh - 230px)' }}
            loading={isLoading}
            className={styles.table}
          />
        </div>
      </div>
      <StaticsDrawer
        open={createModalOpen}
        onClose={() => {
          setCreateModalOpen(false);
          setEditItem(null);
        }}
        record={editItem}
        onSuccess={(isEdit: boolean) => {
          setCreateModalOpen(false);

          if (isEdit) {
            mySelectSystemConfigListByQo(
              {
                pageIndex: curParam.current?.pageIndex || pageInfo.pageIndex,
                pageSize: curParam.current?.pageSize || pageInfo.pageSize,
              },
              curParam.current?.keyword || keyword
            );
          } else {
            mySelectSystemConfigListByQo(
              {
                pageIndex: 1,
                pageSize: curParam.current?.pageSize || pageInfo.pageSize,
              },
              curParam.current?.keyword || keyword
            );
          }
        }}
      />
      <Drawer
        title={
          jsonViewerRecord
            ? `${intl.formatMessage({ id: 'SystemParams.statics.jsonDrawerTitle' })} · ${
              jsonViewerRecord.paramGroupName || jsonViewerRecord.paramGroupCode
            }`
            : intl.formatMessage({ id: 'SystemParams.statics.jsonDrawerTitle' })
        }
        width={720}
        open={jsonViewerOpen}
        destroyOnClose
        onClose={() => {
          setJsonViewerOpen(false);
          setJsonViewerRecord(null);
        }}
        extra={
          jsonViewerRecord?.cacheJson ? (
            <Button
              type="primary"
              icon={<CopyOutlined />}
              onClick={() => {
                const text = jsonViewerRecord.cacheJson;
                if (text) {
                  copy(text);
                  message.success(intl.formatMessage({ id: 'SystemParams.statics.copySuccess' }));
                }
              }}
            >
              {intl.formatMessage({ id: 'SystemParams.statics.copyOriginal' })}
            </Button>
          ) : null
        }
      >
        {jsonDrawerBody}
      </Drawer>
    </>
  );
}
