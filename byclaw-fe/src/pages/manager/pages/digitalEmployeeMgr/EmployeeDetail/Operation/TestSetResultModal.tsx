// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect } from 'react';
import { Modal, Spin, Button, Pagination, Space, message } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import ResizeTable from '@/pages/manager/components/ResizeTable';
import type { ColumnsType } from 'antd/es/table';
import { getTestSetResultPage } from '@/pages/manager/service/DigitalEmployeeMgr';
import Ellipsis from '@/pages/manager/components/Ellipsis';
import TestSetFailReasonModal from './TestSetFailReasonModal';
import styles from './TestSetResultModal.module.less';

type JsExcelPreview = any;

interface TestSetResultItem {
  testSetId: string;
  batchId: string;
  fileName: string | null;
  fileUrl: string | null;
  fileId: string | null;
  processStatus: number; // 0成功，1进行中，2失败
  processStatusName: string;
  testSetAccuracy: number | null;
  testSetIntentRecognitionAccuracy: number | null;
  createTime: string;
  updateTime: string | null;
  failReason: string | null;
  resourceId: string;
  createBy: string;
}

interface TestSetResultModalProps {
  visible: boolean;
  onCancel: () => void;
  agentId?: string;
}

const TestSetResultModal: React.FC<TestSetResultModalProps> = ({ visible, onCancel, agentId }) => {
  const intl = useIntl();
  const [loading, setLoading] = useState(false);
  const [dataSource, setDataSource] = useState<TestSetResultItem[]>([]);
  const [pagination, setPagination] = useState({
    pageNum: 1,
    pageSize: 10,
    total: 0,
  });
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewTitle, setPreviewTitle] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewData, setPreviewData] = useState<Blob | undefined>();
  const excelRootRef = useRef<HTMLDivElement | null>(null);
  const [excelInited, setExcelInited] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);
  const excelLibRef = useRef<any>(null);
  const excelCssLoadedRef = useRef<boolean>(false);
  // 失败原因弹窗状态
  const [failReasonVisible, setFailReasonVisible] = useState(false);
  const [failReason, setFailReason] = useState<string | null>(null);

  useLayoutEffect(() => {
    let viewer: JsExcelPreview | undefined;
    let cancelled = false;
    const root = excelRootRef.current;

    if (!previewVisible || !previewData) {
      return () => {
        cancelled = true;
        viewer?.destroy();
      };
    }

    const taskLoadLib = new Promise<typeof excelLibRef.current | undefined>((resolve) => {
      if (excelLibRef.current) {
        resolve(excelLibRef.current);
        return;
      }
      import('@js-preview/excel')
        .then((res) => {
          excelLibRef.current = res.default || res;
          resolve(excelLibRef.current);
        })
        .catch(() => resolve(excelLibRef.current));
    });

    const taskLoadCss = new Promise<void>((resolve) => {
      if (excelCssLoadedRef.current) {
        resolve();
        return;
      }
      import('@js-preview/excel/lib/index.css')
        .then(() => {
          excelCssLoadedRef.current = true;
          resolve();
        })
        .catch(() => resolve());
    });

    if (previewData) {
      setExcelInited(false);
      const task = Promise.all([taskLoadLib, taskLoadCss])
        .then(([lib]) => {
          if (cancelled) return null;
          if (root && lib) {
            // 清理旧子节点，避免多次渲染叠加
            if (root.firstElementChild) {
              root.firstElementChild.remove();
            }
            return lib.init(root);
          }
          return null;
        })
        .finally(() => {
          if (!cancelled) {
            setExcelInited(true);
          }
        });

      setExcelLoading(true);
      task
        .then((preview) => {
          if (cancelled) return;
          if (preview) {
            viewer = preview as JsExcelPreview;
          }
          return previewData && viewer ? viewer.preview(previewData) : Promise.resolve();
        })
        .finally(() => {
          if (!cancelled) {
            setExcelLoading(false);
          }
        });
    }

    return () => {
      cancelled = true;
      viewer?.destroy();
    };
  }, [previewData, previewVisible]);

  // 构建文件完整访问地址
  const buildFileUrl = useCallback((fileUrl?: string | null) => {
    if (!fileUrl) return null;
    return fileUrl.startsWith('http') ? fileUrl : `${window.location.origin}/byaiService/${fileUrl}`;
  }, []);

  // 获取测试集结果列表
  const fetchTestSetResults = useCallback(
    async (pageNum: number, pageSize: number) => {
      if (!agentId) return;

      try {
        setLoading(true);
        // 切换页码时先清空数据，避免显示旧数据
        setDataSource([]);
        const response = await getTestSetResultPage({
          pageSize,
          pageNum,
          resourceId: agentId,
        });

        if (response?.code === 0 && response?.data) {
          const { rows = [], total = 0 } = response.data;
          setDataSource(rows);
          // 仅更新 total，pageNum/pageSize 由分页组件控制，避免产生依赖环
          setPagination((prev) => ({
            ...prev,
            total,
          }));
        } else {
          message.error(response?.msg || intl.formatMessage({ id: 'operation.testSetResult.fetchFail' }));
          setDataSource([]);
        }
      } catch (error) {
        console.error(intl.formatMessage({ id: 'operation.testSetResult.fetchFail' }), error);
        message.error(intl.formatMessage({ id: 'operation.testSetResult.fetchFail' }));
        setDataSource([]);
      } finally {
        setLoading(false);
      }
    },
    [agentId, intl]
  );

  // 获取测试集结果数据
  useEffect(() => {
    if (visible && agentId) {
      // 弹窗打开时重置到第一页并拉取数据，避免依赖旧分页信息
      setPagination((prev) => ({ ...prev, pageNum: 1, pageSize: 10 }));
      fetchTestSetResults(1, 10);
    } else {
      // 关闭时清空数据并重置分页
      setDataSource([]);
      setPagination({
        pageNum: 1,
        pageSize: 10,
        total: 0,
      });
    }
    // 这里只依赖弹窗开关和 agentId，分页变化时通过 Pagination 的 onChange 主动触发请求
  }, [visible, agentId, fetchTestSetResults]);

  // 处理预览
  const handleView = useCallback(
    async (record: TestSetResultItem) => {
      const fullUrl = buildFileUrl(record.fileUrl);
      if (!fullUrl) {
        message.warning(intl.formatMessage({ id: 'operation.testSetResult.fileLinkNotExist' }));
        return;
      }

      setPreviewVisible(true);
      setPreviewTitle(record.fileName || intl.formatMessage({ id: 'operation.testSetResult.view' }));
      setPreviewLoading(true);
      setPreviewData(undefined);

      try {
        const response = await fetch(fullUrl, { credentials: 'same-origin' });
        if (!response.ok) {
          throw new Error(`preview fetch failed: ${response.status}`);
        }
        const blob = await response.blob();
        setPreviewData(blob);
      } catch (error) {
        console.error('preview excel failed', error);
        message.error(intl.formatMessage({ id: 'operation.testSetResult.previewFail', defaultMessage: '预览失败' }));
      } finally {
        setPreviewLoading(false);
      }
    },
    [buildFileUrl, intl]
  );

  // 处理下载
  const handleDownload = useCallback(
    (record: TestSetResultItem) => {
      const downloadUrl = buildFileUrl(record.fileUrl);
      if (!downloadUrl) {
        message.warning(intl.formatMessage({ id: 'operation.testSetResult.fileLinkNotExist' }));
        return;
      }

      // 通过创建隐藏的 a 标签触发浏览器下载
      const link = document.createElement('a');
      link.href = downloadUrl;
      // 给一个默认的文件名，后端如果有 Content-Disposition 也会覆盖
      if (record.fileName) {
        link.download = record.fileName;
      }
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    },
    [buildFileUrl, intl]
  );

  // 处理查看失败原因
  const handleViewFailReason = useCallback((record: TestSetResultItem) => {
    setFailReason(record.failReason);
    setFailReasonVisible(true);
  }, []);

  // 表格列配置
  const columns: ColumnsType<TestSetResultItem> = useMemo(
    () => [
      {
        title: intl.formatMessage({ id: 'operation.testSetResult.testSet' }),
        dataIndex: 'fileName',
        key: 'fileName',
        width: 200,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        render: (text: string | null, _record: TestSetResultItem) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AntdIcon type="icon-Excel" style={{ fontSize: 12 }} />
            <Ellipsis tooltip lines={1}>
              {text}
            </Ellipsis>
          </div>
        ),
      },
      {
        title: intl.formatMessage({ id: 'operation.testSetResult.status' }),
        dataIndex: 'processStatus',
        key: 'processStatus',
        width: 120,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        render: (status: number, _record: TestSetResultItem) => {
          if (status === 0) {
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <CheckCircleOutlined style={{ color: '#15CC3E', fontSize: 14 }} />
                <span>{intl.formatMessage({ id: 'operation.testSetResult.statusSuccess' })}</span>
              </div>
            );
          }
          if (status === 2) {
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <CloseCircleOutlined style={{ color: '#FF7D00', fontSize: 14 }} />
                <span>{intl.formatMessage({ id: 'operation.testSetResult.statusFailed' })}</span>
              </div>
            );
          }
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>{intl.formatMessage({ id: 'operation.testSetResult.statusProcessing' })}</span>
            </div>
          );
        },
      },
      {
        title: intl.formatMessage({ id: 'operation.testSetResult.responseAccuracy' }),
        dataIndex: 'testSetAccuracy',
        key: 'testSetAccuracy',
        width: 120,
        render: (value: number | null) => {
          if (value !== null && value !== undefined) {
            return `${value}%`;
          }
          return '-';
        },
      },
      {
        title: intl.formatMessage({ id: 'operation.testSetResult.intentRecognitionAccuracy' }),
        dataIndex: 'testSetIntentRecognitionAccuracy',
        key: 'testSetIntentRecognitionAccuracy',
        width: 150,
        render: (value: number | null) => {
          if (value !== null && value !== undefined) {
            return `${value}%`;
          }
          return '-';
        },
      },
      {
        title: intl.formatMessage({ id: 'operation.testSetResult.time' }),
        dataIndex: 'createTime',
        key: 'createTime',
        width: 180,
        render: (text: string) => {
          if (!text) return '-';
          return text;
        },
      },
      {
        title: intl.formatMessage({ id: 'operation.testSetResult.action' }),
        key: 'action',
        width: 120,
        render: (_: any, record: TestSetResultItem) => {
          // 如果状态是失败(2)，显示失败原因按钮
          if (record.processStatus === 2) {
            return (
              <Button
                type="link"
                size="small"
                style={{ padding: 0, color: '#FF7D00' }}
                onClick={() => handleViewFailReason(record)}
              >
                {intl.formatMessage({ id: 'operation.testSet.viewFailReason' })}
              </Button>
            );
          }
          // 其他状态显示查看和下载按钮
          return (
            <Space>
              <Button type="link" size="small" style={{ padding: 0 }} onClick={() => handleView(record)}>
                {intl.formatMessage({ id: 'operation.testSetResult.view' })}
              </Button>
              <Button type="link" size="small" style={{ padding: 0 }} onClick={() => handleDownload(record)}>
                {intl.formatMessage({ id: 'operation.testSetResult.download' })}
              </Button>
            </Space>
          );
        },
      },
    ],
    [handleView, handleDownload, handleViewFailReason, intl]
  );

  return (
    <Modal
      title={intl.formatMessage({ id: 'operation.testSetResult.title' })}
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={1000}
      centered
      className={styles.testSetResultModal}
      destroyOnHidden
    >
      <Spin spinning={loading}>
        <div className={styles.testSetResultContent}>
          <ResizeTable
            id="testSetResultTable"
            columns={columns}
            dataSource={dataSource}
            rowKey="batchId"
            className={styles.table}
            pagination={false}
          />
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <Pagination
              current={pagination.pageNum}
              pageSize={pagination.pageSize}
              total={pagination.total}
              showSizeChanger
              showQuickJumper
              showTotal={(total, range) =>
                intl.formatMessage({ id: 'orgMgr.pagination.total' }, { start: range[0], end: range[1], total })
              }
              onChange={(page, size) => {
                // 切换页码或每页条数时，先更新分页，再按新分页拉取数据
                setDataSource([]);
                setPagination((prev) => {
                  const next = {
                    ...prev,
                    pageNum: page,
                    pageSize: size || prev.pageSize,
                  };
                  // 使用更新后的分页信息调用接口，避免依赖 useEffect
                  fetchTestSetResults(next.pageNum, next.pageSize);
                  return next;
                });
              }}
            />
          </div>
        </div>
      </Spin>
      <Modal
        title={previewTitle || intl.formatMessage({ id: 'operation.testSetResult.view' })}
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={null}
        width={1000}
        destroyOnHidden
        bodyStyle={{ padding: 0 }}
      >
        <section className={styles.excelPreview} style={{ width: '100%', height: '70vh' }}>
          <Spin spinning={previewLoading || !excelInited || excelLoading}>
            <div ref={excelRootRef} style={{ width: '100%', height: '100%', overflow: 'auto' }} />
          </Spin>
        </section>
      </Modal>
      {/* 失败原因弹窗 */}
      <TestSetFailReasonModal
        visible={failReasonVisible}
        onCancel={() => setFailReasonVisible(false)}
        failReason={failReason}
      />
    </Modal>
  );
};

export default TestSetResultModal;
