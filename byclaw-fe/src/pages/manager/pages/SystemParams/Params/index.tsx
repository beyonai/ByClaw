import React, { useEffect } from 'react';
import classNames from 'classnames';
import { CopyOutlined, ReloadOutlined, PlusOutlined } from '@ant-design/icons';
import copy from 'copy-to-clipboard';
import { trim, debounce } from 'lodash';
import JSONPretty from 'react-json-prettify';
import { github as jsonGithubTheme } from 'react-json-prettify/dist/themes';
import { message, Table, Button, Typography, Input, Space, Popconfirm, Drawer, Alert } from 'antd';
import { useIntl } from '@umijs/max';
import {
  selectSystemConfigByQo,
  deleteSystemConfigById,
  clearOneSystemConfigCache,
  clearAllSystemConfigCache,
} from '@/pages/manager/service/System';

import CreateModal from './CreateModal';

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
  paramId: number;
  paramCode: string;
  paramName: string;
  paramEnName: string;
  paramValue: string;
  paramDesc: string;
  paramType: string;
  paramGroupCode: string;
  paramGroupName: string | null;
  paramGroupEnName: string | null;
  paramSeq: number;
  paramText: string | null;
};

const SystemParams = () => {
  const intl = useIntl();
  const [pageInfo, setPageInfo] = React.useState({ pageIndex: 1, pageSize: 20, total: 0, totalPage: 0 });
  const [keyword, setKeyword] = React.useState('');
  const [list, setList] = React.useState<SystemParamsItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [editItem, setEditItem] = React.useState<SystemParamsItem | null>(null);
  const [createModalOpen, setCreateModalOpen] = React.useState(false);

  const [clearAllSystemConfigCacheLoading, setClearAllSystemConfigCacheLoading] = React.useState(false);

  const [valueViewerOpen, setValueViewerOpen] = React.useState(false);
  const [valueViewerRecord, setValueViewerRecord] = React.useState<SystemParamsItem | null>(null);

  const curParam = React.useRef<{ pageIndex?: number; pageSize?: number; keyword?: string }>({});

  const mySelectSystemConfigByQo = React.useCallback(
    (myPageInfo: { pageIndex: number; pageSize: number }, keyword?: string) => {
      setIsLoading(true);

      const p = {
        pageIndex: myPageInfo.pageIndex,
        pageSize: myPageInfo.pageSize,
        keyword,
      };

      curParam.current = p;

      return selectSystemConfigByQo(p)
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

  const openValueViewer = React.useCallback((record: SystemParamsItem) => {
    setValueViewerRecord(record);
    setValueViewerOpen(true);
  }, []);

  const columns = React.useMemo(() => {
    return [
      {
        title: intl.formatMessage({ id: 'SystemParams.params.name' }),
        dataIndex: 'paramName',
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
        title: intl.formatMessage({ id: 'SystemParams.params.enName' }),
        dataIndex: 'paramEnName',
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
        dataIndex: 'paramCode',
        align: 'left' as const,
        render: (value: string) => {
          return (
            <Typography.Paragraph
              copyable={{
                icon: [<CopyOutlined key="paramCode_copy" style={{ color: '#999' }} />],
              }}
              editable={false}
              style={{ textAlign: 'left' }}
            >
              {value}
            </Typography.Paragraph>
          );
        },
      },
      {
        title: intl.formatMessage({ id: 'SystemParams.params.desc' }),
        dataIndex: 'paramDesc',
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
        title: intl.formatMessage({ id: 'SystemParams.params.value' }),
        dataIndex: 'paramValue',
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
                  openValueViewer(record);
                },
              }}
              copyable={
                value
                  ? {
                    icon: [<CopyOutlined key="paramValue_copy" style={{ color: '#999' }} />],
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
        align: 'left' as const,
        render: (_: any, record: SystemParamsItem) => {
          return (
            <Space size="small">
              <Button
                size="small"
                type="link"
                onClick={() => {
                  setIsLoading(true);
                  clearOneSystemConfigCache({
                    paramId: record.paramId,
                  })
                    .then((res: any) => {
                      if (`${res?.code}` === '0') {
                        message.success(res?.msg);
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
                  deleteSystemConfigById({
                    paramId: record.paramId,
                  })
                    .then((res: any) => {
                      if (`${res?.code}` === '0') {
                        message.success(res?.msg);
                        mySelectSystemConfigByQo(
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
  }, [intl, openValueViewer, pageInfo, mySelectSystemConfigByQo]);

  const valueDrawerBody = React.useMemo(() => {
    const raw = valueViewerRecord?.paramValue;
    if (raw === null || raw === undefined || raw === '') {
      return <Typography.Text type="secondary">—</Typography.Text>;
    }
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
          <pre className={styles.valueDrawerPre}>{raw}</pre>
        </>
      );
    }
    if (isJsonPrettyCompatible(parsed)) {
      return (
        <div className={styles.valueDrawerScroll}>
          <JSONPretty json={parsed as any} theme={jsonGithubTheme} padding={12} />
        </div>
      );
    }
    return <pre className={styles.valueDrawerPre}>{JSON.stringify(parsed, null, 2)}</pre>;
  }, [intl, valueViewerRecord]);

  useEffect(() => {
    mySelectSystemConfigByQo(pageInfo, keyword);
  }, []);

  const clearAllSystemConfigCacheDebounce = React.useCallback(
    debounce(() => {
      setClearAllSystemConfigCacheLoading(true);
      clearAllSystemConfigCache()
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
        <div className="ub ub-ac gap8" style={{ justifyContent: 'end' }}>
          <Input.Search
            placeholder={intl.formatMessage({ id: 'SystemParams.params.keywordPlaceholder' })}
            value={keyword}
            onChange={(e) => {
              setKeyword(trim(e.target.value));
            }}
            onSearch={() => {
              mySelectSystemConfigByQo(
                {
                  ...pageInfo,
                  pageIndex: 1,
                },
                keyword
              );
            }}
            onPressEnter={() => {
              mySelectSystemConfigByQo(
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
            type="primary"
            icon={<ReloadOutlined size={16} />}
            onClick={clearAllSystemConfigCacheDebounce}
            loading={clearAllSystemConfigCacheLoading}
          >
            {intl.formatMessage({ id: 'SystemParams.params.refreshAll' })}
          </Button>
          {/* <Button
            type="primary"
            icon={<FileAddOutlined size={16} />}
            onClick={() => {
              setDefaultSkillInitLoading(true);
              createFileAgent()
                .then((res: any) => {
                  if (`${res?.code}` === '0') {
                    message.success(res.msg);
                  } else {
                    message.error(res?.msg);
                  }
                })
                .finally(() => {
                  setDefaultSkillInitLoading(false);
                });
            }}
            loading={defaultSkillInitLoading}
          >
            {intl.formatMessage({ id: 'SystemParams.params.initDefaultSkill' })}
          </Button> */}
        </div>
        <div className={classNames('ub-f1', styles.tableScroll)}>
          <Table<SystemParamsItem>
            rowKey="paramId"
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
                mySelectSystemConfigByQo(
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
      <CreateModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={(isEdit: boolean) => {
          setCreateModalOpen(false);

          if (isEdit) {
            mySelectSystemConfigByQo(
              {
                pageIndex: curParam.current?.pageIndex || pageInfo.pageIndex,
                pageSize: curParam.current?.pageSize || pageInfo.pageSize,
              },
              curParam.current?.keyword || keyword
            );
          } else {
            mySelectSystemConfigByQo(
              {
                pageIndex: 1,
                pageSize: curParam.current?.pageSize || pageInfo.pageSize,
              },
              curParam.current?.keyword || keyword
            );
          }
        }}
        record={editItem}
      />
      <Drawer
        title={
          valueViewerRecord
            ? `${intl.formatMessage({ id: 'SystemParams.params.valueDrawerTitle' })} · ${
              valueViewerRecord.paramName || valueViewerRecord.paramCode
            }`
            : intl.formatMessage({ id: 'SystemParams.params.valueDrawerTitle' })
        }
        width={720}
        open={valueViewerOpen}
        destroyOnClose
        onClose={() => {
          setValueViewerOpen(false);
          setValueViewerRecord(null);
        }}
        extra={
          (valueViewerRecord?.paramValue ?? '') !== '' ? (
            <Button
              type="primary"
              icon={<CopyOutlined />}
              onClick={() => {
                const text = valueViewerRecord.paramValue;
                copy(text);
                message.success(intl.formatMessage({ id: 'SystemParams.statics.copySuccess' }));
              }}
            >
              {intl.formatMessage({ id: 'SystemParams.statics.copyOriginal' })}
            </Button>
          ) : null
        }
      >
        {valueDrawerBody}
      </Drawer>
    </>
  );
};

export default SystemParams;
