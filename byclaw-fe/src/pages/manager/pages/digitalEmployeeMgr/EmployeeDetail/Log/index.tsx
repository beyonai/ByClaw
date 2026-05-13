// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';

import { useDispatch, useIntl } from '@umijs/max';
import { Button, Input, message, Pagination, Space, Divider } from 'antd';

import ResizeTable from '@/pages/manager/components/ResizeTable';
import Layout from '@/pages/manager/components/ausong/Layout';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import Ellipsis from '@/pages/manager/components/Ellipsis';
import download from '@/pages/manager/utils/requestDownload';
import { getFilterParams } from '@/pages/manager/utils/managerUtils';
import { feedbackTypeOpts } from '@/pages/manager/constants/conversation';
// import { handleFeedbackMsg } from '@/pages/manager/service/ConversationMgr';
import AssignModal from './AssignModal';

import {
  getColumnOptionsSelectSettingMulti,
  getColumnOptionsTimeSetting,
  getColumnValueRangePickerSetting,
  getColumnFeedbackTypeSetting,
} from '../util';
import styles from '../index.module.less';

const filterKeyToParamKeyMap: Record<string, string> = {
  projectName: 'projectIds',
  accessTerminal: 'resAccessTerminals',
  createTime: 'createTime',
  taskDueTime: 'taskDueTimeRange',
  feedbackScore: 'feedbackScoreRange',
  feedbackLabels: 'feedbackLabels',
  feedbackType: 'feedbackType',
};

const filterKeys = Object.keys(filterKeyToParamKeyMap);

interface LogProps {
  agentId?: string;
  title?: string;
  agentName?: string;
  projectList: { label: string; value: any }[];
  accessTerminalList: { label: string; value: any }[];
  contentFeedbackType: { label: string; value: any }[];
  agentType?: string;
  onSelectLog: (log: any) => void;
}

const Log: React.FC<LogProps> = ({
  agentId,
  title,
  agentName,
  projectList,
  accessTerminalList,
  contentFeedbackType,
  agentType,
  onSelectLog,
}) => {
  const dispatch = useDispatch();
  const intl = useIntl();

  const [logData, setLogData] = useState<{ dataSource: any[]; total: number }>({
    dataSource: [],
    total: 0,
  });
  const [searchValue, setSearchValue] = useState('');
  const [logLoading, setLogLoading] = useState(false);

  const [filter, setFilter] = useState<Record<string, any>>(() =>
    filterKeys.reduce((m, k) => {
      // eslint-disable-next-line no-param-reassign
      m[k] = null;
      return m;
    }, {} as Record<string, any>)
  );
  const filterRef = useRef<Record<string, any>>(filter);

  const [logPageInfo, setLogPageInfo] = useState({
    pageIndex: 1,
    pageSize: 10,
  });

  const [exportLoading, setExportLoading] = useState(false);
  const [selectedLogRowKeys, setSelectedLogRowKeys] = useState<React.Key[]>([]);
  const [updateAt, setUpdateAt] = useState<number | undefined>();
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [currentAssignRecord, setCurrentAssignRecord] = useState<any>(null);

  const handleViewDetails = (record: any) => {
    if (record.sessionId && record.sessionId !== 'null') {
      let feedbackLabels;
      if (record.feedbackLabels) {
        feedbackLabels = record.feedbackLabels.reduce((acc: any[], x: any) => {
          if (x) {
            acc.push(x);
          }
          return acc;
        }, []);
      }
      onSelectLog({
        ...record,
        feedbackLabels,
        agentName,
        agentType,
      });
    }
  };

  // const handleHandle = async (record: any) => {
  //   const res = await handleFeedbackMsg(record.askMsgId);
  //   if (res.code === 0) {
  //     setUpdateAt(Date.now());
  //   }
  // };

  /**
   * 打开指派弹窗
   */
  // const handleOpenAssign = (record: any) => {
  //   setCurrentAssignRecord(record);
  //   setAssignModalVisible(true);
  // };

  /**
   * 关闭指派弹窗
   */
  const handleCloseAssign = () => {
    setAssignModalVisible(false);
    setCurrentAssignRecord(null);
  };

  /**
   * 确认指派
   * 指派成功后回调，刷新列表
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleAssignOk = async (_values: { handlerId: number; reason: string }) => {
    // 接口调用已在 AssignModal 中完成，这里只需要关闭弹窗和刷新列表
    setAssignModalVisible(false);
    setCurrentAssignRecord(null);
    // 刷新列表
    setUpdateAt(Date.now());
  };

  const logColumns = useMemo(
    () => [
      {
        title: intl.formatMessage({
          id: 'conversationMgr.table.sourceChannel',
        }),
        dataIndex: 'projectName',
        key: 'projectName',
        width: 120,
        // filteredValue: filterRef.current?.projectName,
        // ...(getColumnOptionsSelectSettingMulti as any)(projectList, undefined),
      },
      // {
      //   title: intl.formatMessage({
      //     id: 'conversationMgr.filter.sourceTerminal',
      //   }),
      //   dataIndex: 'accessTerminal',
      //   key: 'accessTerminal',
      //   width: 120,
      //   filteredValue: filterRef.current?.accessTerminal,
      //   ...(getColumnOptionsSelectSettingMulti as any)(accessTerminalList, undefined),
      // },
      {
        title: intl.formatMessage({
          id: 'conversationMgr.table.questionContent',
        }),
        dataIndex: 'userQuestion',
        key: 'userQuestion',
        width: 200,
        ellipsis: true,
      },
      {
        title: intl.formatMessage({
          id: 'conversationMgr.table.replyContent',
        }),
        dataIndex: 'systemAnswer',
        key: 'systemAnswer',
        width: 250,
        ellipsis: true,
      },
      {
        title: intl.formatMessage({
          id: 'conversationMgr.table.conversationTime',
        }),
        dataIndex: 'createTime',
        key: 'createTime',
        width: 150,
        filteredValue: filterRef.current?.createTime,
        ...getColumnOptionsTimeSetting(true),
      },
      {
        title: intl.formatMessage({
          id: 'conversationMgr.table.questioner',
        }),
        dataIndex: 'userName',
        key: 'userName',
        width: 100,
      },
      // {
      //   title: intl.formatMessage({
      //     id: 'conversationMgr.table.responseObject',
      //   }),
      //   dataIndex: 'responseObj',
      //   key: 'responseObj',
      //   width: 120,
      // },
      // {
      //   title: intl.formatMessage({
      //     id: 'conversationMgr.table.relatedKnowledge',
      //   }),
      //   dataIndex: 'relatedKnowledge',
      //   key: 'relatedKnowledge',
      //   width: 120,
      // },
      {
        title: intl.formatMessage({
          id: 'conversationMgr.table.firstTextDuration',
        }),
        dataIndex: 'firstTextDuration',
        key: 'firstTextDuration',
        width: 120,
      },
      {
        title: intl.formatMessage({
          id: 'conversationMgr.table.timeConsumed',
        }),
        dataIndex: 'taskDueTime',
        key: 'taskDueTime',
        width: 100,
        filteredValue: filterRef.current?.taskDueTime,
        ...getColumnValueRangePickerSetting(),
      },
      {
        title: intl.formatMessage({
          id: 'conversationMgr.table.userFeedbackType',
        }),
        dataIndex: 'feedbackType',
        key: 'feedbackType',
        width: 120,
        filteredValue: filterRef.current?.feedbackType,
        ...getColumnFeedbackTypeSetting(),
        render: (v: any) => {
          const type = feedbackTypeOpts.find((ele) => ele.key === v);
          if (!type) return null;
          return (
            <Ellipsis lines={1} tooltip>
              {type.label}
            </Ellipsis>
          );
        },
      },
      {
        title: intl.formatMessage({
          id: 'conversationMgr.table.userFeedbackTag',
        }),
        dataIndex: 'feedbackLabels',
        key: 'feedbackLabels',
        width: 150,
        filteredValue: filterRef.current?.feedbackLabels,
        ...(getColumnOptionsSelectSettingMulti as any)(contentFeedbackType, undefined),
        render: (v: any[]) => (
          <Ellipsis lines={1} tooltip>
            {v?.join(',')}
          </Ellipsis>
        ),
      },
      // {
      //   title: intl.formatMessage({
      //     id: 'conversationMgr.table.userFeedbackScore',
      //   }),
      //   dataIndex: 'feedbackScore',
      //   key: 'feedbackScore',
      //   width: 120,
      //   render: (v: number) => <Rate value={v} allowHalf disabled />,
      //   filteredValue: filterRef.current?.feedbackScore,
      //   ...getColumnValueRangePickerSetting(),
      // },
      {
        title: intl.formatMessage({
          id: 'conversationMgr.table.userFeedbackContent',
        }),
        dataIndex: 'feedbackContent',
        key: 'feedbackContent',
        width: 200,
        ellipsis: true,
      },
      // {
      //   title: intl.formatMessage({
      //     id: 'conversationMgr.table.isHandled',
      //   }),
      //   dataIndex: 'isHandle',
      //   key: 'isHandle',
      //   width: 100,
      //   render: (v: number) => {
      //     // eslint-disable-next-line no-param-reassign
      //     v = v || 0;
      //     const statusItem = isHandleStatus.find((ele) => ele.value === v);
      //     if (!statusItem) return null;
      //     return (
      //       <Badge
      //         color={statusItem.color}
      //         text={intl.formatMessage({
      //           id: v === 0 ? 'conversationMgr.status.unhandled' : 'conversationMgr.status.handled',
      //         })}
      //       />
      //     );
      //   },
      // },
      {
        title: intl.formatMessage({
          id: 'common.operation',
        }),
        key: 'action',
        width: 100,
        fixed: 'right',
        render: (_: any, record: any) => (
          <Space>
            <Button type="link" size="small" onClick={() => handleViewDetails(record)}>
              {intl.formatMessage({ id: 'employeeDetail.viewDetails' })}
            </Button>
            {!record.isHandle && (
              <>
                {/* {record.isAssign ? (
                  <Button type="link" size="small" disabled>
                    {intl.formatMessage({ id: 'employeeDetail.assigned' })}
                  </Button>
                ) : (
                  <Button type="link" size="small" onClick={() => handleOpenAssign(record)}>
                    {intl.formatMessage({ id: 'employeeDetail.assign' })}
                  </Button>
                )} */}
                {/* <Popconfirm
                  title={intl.formatMessage({
                    id: 'employeeDetail.markTohandledDesc',
                  })}
                  placement="topRight"
                  overlayClassName={styles.popconfirm}
                  onConfirm={() => handleHandle(record)}
                >
                  <Button type="link" size="small">
                    {intl.formatMessage({ id: 'employeeDetail.markTohandled' })}
                  </Button>
                </Popconfirm> */}
              </>
            )}
          </Space>
        ),
      },
    ],
    [intl, projectList, accessTerminalList, contentFeedbackType]
  );

  const getMessageList = useCallback(
    (params: Record<string, any> = {}) => {
      setLogLoading(true);
      const result = {
        ...getFilterParams(filterKeyToParamKeyMap, filterRef.current, (value: any) => value),
      };
      if (filterRef.current?.createTime) {
        result.createTimeRange = filterRef.current?.createTime?.map((it: any) => it.format('YYYY-MM-DD HH:mm:ss'));
        delete result.createTime;
      }
      dispatch({
        type: 'conversationMgr/getMessageList',
        payload: {
          pageIndex: logPageInfo.pageIndex,
          pageSize: logPageInfo.pageSize,
          keyword: searchValue,
          resObjIdList: agentId ? [agentId] : [],
          ...result,
          ...params,
        },
        success: (res: any) => {
          const { list: newList = [], pageInfo: newPageInfo } = res || {};
          setLogData({
            dataSource: newList,
            total: newPageInfo.total,
          });
          setSelectedLogRowKeys([]);
          setLogLoading(false);
        },
        fail: () => {
          setLogLoading(false);
        },
      });
    },
    [logPageInfo, searchValue, agentId, dispatch]
  );

  const handleExportMessageList = useCallback(async () => {
    if (!agentId) {
      message.warning(intl.formatMessage({ id: 'employeeDetail.selectEmployeeFirst' }));
      return;
    }

    if (!logData.dataSource || logData.dataSource.length === 0) {
      message.warning(intl.formatMessage({ id: 'employeeDetail.noDataToExport' }));
      return;
    }

    setExportLoading(true);
    try {
      const result = {
        ...getFilterParams(filterKeyToParamKeyMap, filterRef.current, (value: any) => value),
      };

      if (filterRef.current?.createTime) {
        result.createTimeRange = filterRef.current?.createTime?.map((it: any) => it.format('YYYY-MM-DD HH:mm:ss'));
        delete result.createTime;
      }

      const params = {
        pageIndex: logPageInfo.pageIndex,
        pageSize: logPageInfo.pageSize,
        keyword: searchValue,
        resObjIdList: agentId ? [agentId] : [],
        ...result,
      };

      const fileName = `${
        title || agentName || intl.formatMessage({ id: 'employeeDetail.digitalEmployee' })
      }-${intl.formatMessage({ id: 'employeeDetail.qaLog' })}.xlsx`;

      download(
        '/system/message/export',
        {
          method: 'POST',
          body: params,
          handleObjUrl: (fileUrl: string) => {
            let link = document.createElement('a');
            link.href = fileUrl;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            setTimeout(() => {
              document.body.removeChild(link);
              window.URL.revokeObjectURL(fileUrl);
              link = null as any;
            }, 100);
          },
        },
        (success: boolean) => {
          if (success) {
            message.success(intl.formatMessage({ id: 'employeeDetail.exportSuccess' }));
          } else {
            message.error(intl.formatMessage({ id: 'employeeDetail.exportFail' }));
          }
          setExportLoading(false);
        }
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('导出失败:', error);
      message.error(intl.formatMessage({ id: 'employeeDetail.exportFail' }));
      setExportLoading(false);
    }
  }, [agentId, searchValue, logData.dataSource, title, agentName, intl, logPageInfo]);

  // 批量导出
  const handleBatchHandle = useCallback(async () => {
    if (!agentId) {
      message.warning(intl.formatMessage({ id: 'employeeDetail.selectEmployeeFirst' }));
      return;
    }

    if (!selectedLogRowKeys || selectedLogRowKeys.length === 0) {
      message.warning(intl.formatMessage({ id: 'employeeDetail.selectRecordsFirst' }));
      return;
    }

    setExportLoading(true);
    try {
      const result = {
        ...getFilterParams(filterKeyToParamKeyMap, filterRef.current, (value: any) => value),
      };

      if (filterRef.current?.createTime) {
        result.createTimeRange = filterRef.current?.createTime?.map((it: any) => it.format('YYYY-MM-DD HH:mm:ss'));
        delete result.createTime;
      }

      const params = {
        pageIndex: logPageInfo.pageIndex,
        pageSize: logPageInfo.pageSize,
        keyword: searchValue,
        resObjIdList: agentId ? [agentId] : [],
        ...result,
        // 批量导出参数
        relIdList: selectedLogRowKeys,
        isAllNotSelect: true,
      };

      const fileName = `${
        title || agentName || intl.formatMessage({ id: 'employeeDetail.digitalEmployee' })
      }-${intl.formatMessage({ id: 'employeeDetail.qaLog' })}.xlsx`;

      download(
        '/system/message/export',
        {
          method: 'POST',
          body: params,
          handleObjUrl: (fileUrl: string) => {
            let link = document.createElement('a');
            link.href = fileUrl;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            setTimeout(() => {
              document.body.removeChild(link);
              window.URL.revokeObjectURL(fileUrl);
              link = null as any;
            }, 100);
          },
        },
        (success: boolean) => {
          if (success) {
            message.success(intl.formatMessage({ id: 'employeeDetail.exportSuccess' }));
            setSelectedLogRowKeys([]);
          }
          setExportLoading(false);
        }
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('批量导出失败:', error);
      message.error(intl.formatMessage({ id: 'employeeDetail.exportFail' }));
      setExportLoading(false);
    }
  }, [agentId, selectedLogRowKeys, searchValue, filterRef, logPageInfo, title, agentName, intl]);

  useEffect(() => {
    if (agentId) {
      getMessageList();
    }
  }, [logPageInfo, agentId, updateAt]);

  const onChange = (_: any, newFilter: Record<string, any>) => {
    const finalFilter = {
      ...newFilter,
    };
    setFilter(finalFilter);
    filterRef.current = finalFilter;
    setLogPageInfo({ ...logPageInfo, pageIndex: 1 });
  };

  const getFilterValue = (key: string) => {
    if (key === 'createTime') {
      return filterRef.current?.[key]?.map((it: any) => it.format('YYYY-MM-DD HH:mm:ss')).join(' - ');
    }
    if (key === 'feedbackLabels') {
      return filterRef.current?.[key]
        ?.map((it: any) => contentFeedbackType.find((ele) => ele.value === it)?.label)
        .join(',');
    }
    if (key === 'projectName') {
      return filterRef.current?.[key]?.map((it: any) => projectList.find((ele) => ele.value === it)?.label).join(',');
    }
    if (key === 'accessTerminal') {
      return filterRef.current?.[key]
        ?.map((it: any) => accessTerminalList.find((ele) => ele.value === it)?.label)
        .join(',');
    }
    if (key === 'feedbackType') {
      const item = feedbackTypeOpts.find((ele) => ele.key === filterRef.current?.[key]);
      return item?.label;
    }
    return filterRef.current?.[key]?.join('-');
  };

  const renderFilterKeys = useMemo(() => {
    const resultData = filterKeys.filter((key) => filterRef.current?.[key]);
    return resultData.map((key, index) => (
      // eslint-disable-next-line react/no-array-index-key
      <React.Fragment key={key}>
        <div className={styles.filterKey}>
          <span>{logColumns?.find((it) => it.dataIndex === key)?.title}:</span>
          {getFilterValue(key)}
          <span>
            <AntdIcon
              type="icon-a-Closex"
              className={styles.closeIcon}
              onClick={() => {
                const newFilterValue = {
                  ...filterRef.current,
                  [key]: undefined,
                };
                setFilter(newFilterValue);
                filterRef.current = newFilterValue;
                getMessageList();
              }}
            />
          </span>
        </div>
        <Divider type="vertical" />
        {index === resultData.length - 1 && (
          <Button
            style={{ margin: 0, padding: 0 }}
            type="link"
            onClick={() => {
              const cleared = filterKeys.reduce((m, k) => {
                // eslint-disable-next-line no-param-reassign
                m[k] = null;
                return m;
              }, {} as Record<string, any>);
              setFilter(cleared);
              filterRef.current = cleared;
              getMessageList();
            }}
          >
            {intl.formatMessage({ id: 'common.clear' })}
          </Button>
        )}
      </React.Fragment>
    ));
  }, [filter, logColumns, projectList, accessTerminalList, contentFeedbackType]);

  const logRowSelection = useMemo(
    () => ({
      // 统一选择列宽度，避免表头、多行选择框错位
      columnWidth: 48,
      selectedRowKeys: selectedLogRowKeys,
      onChange: (keys: React.Key[]) => {
        setSelectedLogRowKeys(keys);
      },
    }),
    [selectedLogRowKeys]
  );

  return (
    <div className={styles.logContent}>
      <div className={styles.logTitle}>
        <div className={styles.logTitleLeft}>{renderFilterKeys}</div>
        <Space>
          <Button
            type="primary"
            icon={<AntdIcon type="icon-a-Downloadxiazai" />}
            loading={exportLoading}
            onClick={handleExportMessageList}
          >
            {intl.formatMessage({ id: 'employeeDetail.export' })}
          </Button>
          <Input
            style={{ width: 300 }}
            placeholder={intl.formatMessage({
              id: 'conversationMgr.search.placeholder',
            })}
            value={searchValue}
            onChange={(e) => {
              setSearchValue(e.target.value);
            }}
            onPressEnter={() => {
              setLogPageInfo({ ...logPageInfo, pageIndex: 1 });
            }}
          />
        </Space>
      </div>
      <div className={styles.logTable}>
        <ResizeTable
          columns={logColumns}
          dataSource={logData.dataSource}
          rowKey={(record: any) => record.relId || record.resMsgId}
          rowSelection={logRowSelection}
          onChange={onChange}
          loading={logLoading}
        />
      </div>
      <div className={styles.footer}>
        <Layout
          left={
            <div
              style={{
                height: '100%',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <span style={{ marginRight: 16, fontSize: 12, color: '#7A8799' }}>
                {intl.formatMessage({ id: 'employeeDetail.selectedCount' }, { count: selectedLogRowKeys.length })}
              </span>
              <Button
                type="primary"
                size="small"
                icon={<AntdIcon type="icon-a-Downloadxiazai" />}
                loading={exportLoading}
                disabled={selectedLogRowKeys.length === 0}
                onClick={handleBatchHandle}
              >
                {intl.formatMessage({ id: 'employeeDetail.batchExport' })}
              </Button>
            </div>
          }
          right={
            <div
              style={{
                height: '100%',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Pagination
                showQuickJumper
                showSizeChanger
                size="small"
                showTotal={(tot, range) =>
                  intl.formatMessage({ id: 'orgMgr.pagination.total' }, { start: range[0], end: range[1], total: tot })
                }
                current={logPageInfo.pageIndex}
                pageSize={logPageInfo.pageSize}
                onChange={(current, pageSize) => {
                  setLogPageInfo({ pageIndex: current, pageSize });
                }}
                total={logData.total}
                className={styles.pagination}
              />
            </div>
          }
        >
          <div />
        </Layout>
      </div>
      {/* 指派弹窗 */}
      <AssignModal
        visible={assignModalVisible}
        agentId={agentId}
        record={currentAssignRecord}
        onCancel={handleCloseAssign}
        onOk={handleAssignOk}
      />
    </div>
  );
};

export default Log;
