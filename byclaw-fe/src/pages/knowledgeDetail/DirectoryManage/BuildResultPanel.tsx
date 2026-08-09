import {
  ApartmentOutlined,
  CheckCircleFilled,
  CloseOutlined,
  CodeOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileOutlined,
  FileMarkdownOutlined,
  ThunderboltFilled,
} from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import { useIntl } from '@umijs/max';
import { Alert, App, Button, Empty, Pagination, Progress, Skeleton, Tabs, Tag, Tooltip } from 'antd';
import Markdown from '@/components/Markdown';
import { downloadResourceFile } from '@/service/file';
import { getKnowledgeBuildResult, type KnowledgeBuildResult } from '@/service/knowledgeCenter';
import { downloadFile } from '@/utils/file';
import styles from './index.module.less';

interface BuildResultViewProps {
  resourceId: string | number;
  result: KnowledgeBuildResult | null;
  loading: boolean;
  chunkLoading: boolean;
  error?: string;
  fallbackFileName: string;
  fallbackFilePath: string;
  onClose: () => void;
  onChunkPageChange: (page: number, pageSize: number) => void;
}

const formatBytes = (bytes?: number | null) => {
  if (bytes === null || bytes === undefined) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const formatDuration = (durationMs?: number) => {
  if (durationMs === null || durationMs === undefined) return '-';
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(durationMs < 10000 ? 2 : 1)} s`;
};

const buildMarkdownName = (fileName?: string) => {
  const name = fileName || 'build-result';
  const index = name.lastIndexOf('.');
  return `${index > 0 ? name.slice(0, index) : name}.md`;
};

const BuildResultView = ({
  resourceId,
  result,
  loading,
  chunkLoading,
  error,
  fallbackFileName,
  fallbackFilePath,
  onClose,
  onChunkPageChange,
}: BuildResultViewProps) => {
  const intl = useIntl();
  const { message } = App.useApp();
  const [sourceDownloading, setSourceDownloading] = useState(false);
  const markdown = result?.markdown?.data || '';
  const status = result?.build?.status || '';
  const completed = status === 'complete';
  const failed = status === 'failed' || status === 'unsupported';
  let statusLabel = intl.formatMessage({ id: 'buildResult.running' });
  if (failed) {
    statusLabel = intl.formatMessage({
      id: status === 'unsupported' ? 'buildResult.unsupported' : 'buildResult.failed',
    });
  } else if (completed) {
    statusLabel = intl.formatMessage({ id: 'buildResult.completed' });
  }

  const handleCopy = async () => {
    if (!markdown) return;
    await navigator.clipboard.writeText(markdown);
    message.success(intl.formatMessage({ id: 'buildResult.copied' }));
  };

  const handleDownloadMarkdown = () => {
    if (!markdown || !result) return;
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = buildMarkdownName(result.fileName);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadSource = async () => {
    const sourceFilePath = result?.filePath || fallbackFilePath;
    if (!sourceFilePath || sourceDownloading) return;

    setSourceDownloading(true);
    try {
      const response: any = await downloadResourceFile({
        resourceId,
        directoryPath: sourceFilePath,
      });
      const fallbackSourceName =
        result?.fileName || fallbackFileName || sourceFilePath.split('/').filter(Boolean).pop() || 'source-file';
      downloadFile({
        file: response?.file,
        fileUrl: response?.fileUrl,
        fileName: response?.fileName || fallbackSourceName,
      });
    } catch (downloadError: any) {
      message.error(downloadError?.message || intl.formatMessage({ id: 'buildResult.downloadSourceFailed' }));
    } finally {
      setSourceDownloading(false);
    }
  };

  const statCards: Array<{
    key: string;
    icon: React.ReactNode;
    label: string;
    value: React.ReactNode;
    detail: string;
    tone: string;
  }> = [];
  if (result) {
    statCards.push(
      {
        key: 'markdown',
        icon: <FileMarkdownOutlined />,
        label: intl.formatMessage({ id: 'buildResult.markdownLines' }),
        value: result.markdown?.lineCount ?? 0,
        detail: formatBytes(result.markdown?.byteCount),
        tone: 'violet',
      },
      {
        key: 'chunks',
        icon: <ApartmentOutlined />,
        label: intl.formatMessage({ id: 'buildResult.chunkCount' }),
        value: result.chunks?.total ?? 0,
        detail: intl.formatMessage({ id: 'buildResult.pieces' }),
        tone: 'blue',
      },
      {
        key: 'embedding',
        icon: <DatabaseOutlined />,
        label: intl.formatMessage({ id: 'buildResult.vectorDimension' }),
        value: result.embedding?.dimension ?? '-',
        detail: `${result.embedding?.coverageRate ?? 0}%`,
        tone: 'cyan',
      },
      {
        key: 'duration',
        icon: <ThunderboltFilled />,
        label: intl.formatMessage({ id: 'buildResult.elapsed' }),
        value: formatDuration(result.build?.durationMs),
        detail: result.fileType?.toUpperCase() || '-',
        tone: 'amber',
      }
    );
  }

  const markdownActions = (
    <div className={styles.buildResultActions}>
      <Tooltip title={intl.formatMessage({ id: 'buildResult.copyMarkdown' })}>
        <Button type="text" icon={<CopyOutlined />} disabled={!markdown} onClick={handleCopy} />
      </Tooltip>
      <Button icon={<FileOutlined />} loading={sourceDownloading} onClick={() => void handleDownloadSource()}>
        {intl.formatMessage({ id: 'buildResult.downloadSource' })}
      </Button>
      <Button icon={<DownloadOutlined />} disabled={!markdown} onClick={handleDownloadMarkdown}>
        {intl.formatMessage({ id: 'buildResult.downloadMarkdown' })}
      </Button>
    </div>
  );

  const tabItems = [];
  if (result) {
    tabItems.push(
      {
        key: 'preview',
        label: (
          <span className={styles.buildResultTabLabel}>
            <EyeOutlined />
            {intl.formatMessage({ id: 'buildResult.preview' })}
          </span>
        ),
        children: (
          <div className={styles.buildResultDocument}>
            {markdown ? (
              <Markdown text={markdown} markdownClass={styles.buildResultMarkdown} />
            ) : (
              <Empty description={intl.formatMessage({ id: 'buildResult.noMarkdown' })} />
            )}
          </div>
        ),
      },
      {
        key: 'source',
        label: (
          <span className={styles.buildResultTabLabel}>
            <CodeOutlined />
            {intl.formatMessage({ id: 'buildResult.source' })}
          </span>
        ),
        children: (
          <div className={styles.buildResultSourceWrap}>
            <pre className={styles.buildResultSource}>
              {markdown || intl.formatMessage({ id: 'buildResult.noMarkdown' })}
            </pre>
          </div>
        ),
      },
      {
        key: 'chunks',
        label: (
          <span className={styles.buildResultTabLabel}>
            <ApartmentOutlined />
            {intl.formatMessage({ id: 'buildResult.chunks' })}
            <span className={styles.buildResultTabCount}>{result.chunks?.total ?? 0}</span>
          </span>
        ),
        children: (
          <div className={styles.buildResultChunkPane}>
            <div className={styles.buildResultCoverageGrid}>
              <div className={styles.buildResultCoverageCard}>
                <div>
                  <span>{intl.formatMessage({ id: 'buildResult.embeddingCoverage' })}</span>
                  <strong>
                    {result.embedding?.embeddedChunkCount ?? 0}/{result.chunks?.total ?? 0}
                  </strong>
                </div>
                <Progress
                  percent={result.embedding?.coverageRate ?? 0}
                  showInfo={false}
                  strokeColor={{ from: '#6d5dfc', to: '#35c7f0' }}
                />
              </div>
              <div className={styles.buildResultCoverageCard}>
                <div>
                  <span>{intl.formatMessage({ id: 'buildResult.indexCoverage' })}</span>
                  <strong>
                    {result.retrieval?.indexedChunkCount ?? 0}/{result.chunks?.total ?? 0}
                  </strong>
                </div>
                <Progress
                  percent={result.retrieval?.coverageRate ?? 0}
                  showInfo={false}
                  strokeColor={{ from: '#0fae96', to: '#55d6a9' }}
                />
              </div>
            </div>
            <Skeleton loading={chunkLoading} active paragraph={{ rows: 6 }}>
              <div className={styles.buildResultChunkList}>
                {(result.chunks?.data || []).map((chunk) => (
                  <article className={styles.buildResultChunkCard} key={chunk.chunkNo}>
                    <div className={styles.buildResultChunkHeader}>
                      <div>
                        <span className={styles.buildResultChunkNo}>#{chunk.chunkNo}</span>
                        <span className={styles.buildResultLineRange}>
                          L{chunk.startLine}–L{chunk.endLine}
                        </span>
                      </div>
                      <div className={styles.buildResultChunkTags}>
                        <Tag color={chunk.hasEmbedding ? 'purple' : 'default'}>
                          {intl.formatMessage({
                            id: chunk.hasEmbedding ? 'buildResult.vectorized' : 'buildResult.notVectorized',
                          })}
                        </Tag>
                        <Tag color={chunk.retrievalIndexed ? 'cyan' : 'default'}>
                          {intl.formatMessage({
                            id: chunk.retrievalIndexed ? 'buildResult.indexed' : 'buildResult.notIndexed',
                          })}
                        </Tag>
                      </div>
                    </div>
                    <div className={styles.buildResultChunkText}>{chunk.content}</div>
                    <div className={styles.buildResultChunkFooter}>
                      {intl.formatMessage(
                        { id: 'buildResult.characters' },
                        { count: chunk.characterCount ?? chunk.content?.length ?? 0 }
                      )}
                    </div>
                  </article>
                ))}
                {!result.chunks?.data?.length && (
                  <Empty description={intl.formatMessage({ id: 'buildResult.noChunks' })} />
                )}
              </div>
              {(result.chunks?.total || 0) > 0 && (
                <Pagination
                  className={styles.buildResultPagination}
                  current={result.chunks.page}
                  pageSize={result.chunks.pageSize}
                  total={result.chunks.total}
                  showSizeChanger
                  pageSizeOptions={[10, 20, 50]}
                  onChange={onChunkPageChange}
                />
              )}
            </Skeleton>
          </div>
        ),
      }
    );
  }

  return (
    <div className={styles.buildResultPanel}>
      <header className={styles.buildResultHero}>
        <div className={styles.buildResultGlow} />
        <div className={styles.buildResultHeroTop}>
          <div className={styles.buildResultEyebrow}>
            <ThunderboltFilled />
            {intl.formatMessage({ id: 'buildResult.title' })}
          </div>
          <Button className={styles.buildResultClose} type="text" icon={<CloseOutlined />} onClick={onClose} />
        </div>
        <div className={styles.buildResultHeroMain}>
          <div className={styles.buildResultFileIcon}>
            <FileMarkdownOutlined />
          </div>
          <div className={styles.buildResultFileInfo}>
            <div className={styles.buildResultFileName}>{result?.fileName || fallbackFileName || '-'}</div>
            <div className={styles.buildResultFilePath}>{result?.filePath || fallbackFilePath || '-'}</div>
          </div>
          {result && (
            <div
              className={`${styles.buildResultStatus} ${
                failed ? styles.isFailed : completed ? styles.isCompleted : ''
              }`}
            >
              {completed && <CheckCircleFilled />}
              <span>{statusLabel}</span>
            </div>
          )}
        </div>
      </header>

      <div className={styles.buildResultBody}>
        {loading && !result ? (
          <div className={styles.buildResultLoading}>
            <Skeleton active paragraph={{ rows: 10 }} />
          </div>
        ) : error ? (
          <Alert
            showIcon
            type="error"
            message={intl.formatMessage({ id: 'buildResult.loadFailed' })}
            description={error}
          />
        ) : result ? (
          <>
            {result.build?.errorMessage && (
              <Alert
                className={styles.buildResultAlert}
                showIcon
                type="error"
                message={statusLabel}
                description={result.build.errorMessage}
              />
            )}
            <div className={styles.buildResultStats}>
              {statCards.map((card) => (
                <div className={`${styles.buildResultStatCard} ${styles[`tone${card.tone}`]}`} key={card.key}>
                  <div className={styles.buildResultStatIcon}>{card.icon}</div>
                  <div className={styles.buildResultStatContent}>
                    <span>{card.label}</span>
                    <strong>{card.value}</strong>
                  </div>
                  <small>{card.detail}</small>
                </div>
              ))}
            </div>
            <Tabs className={styles.buildResultTabs} items={tabItems} tabBarExtraContent={markdownActions} />
          </>
        ) : null}
      </div>
    </div>
  );
};

interface BuildResultPanelProps {
  resourceId: string | number;
  filePath: string;
  fileName: string;
  onClose: () => void;
}

const BuildResultPanel = ({ resourceId, filePath, fileName, onClose }: BuildResultPanelProps) => {
  const [result, setResult] = useState<KnowledgeBuildResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [chunkLoading, setChunkLoading] = useState(false);
  const [error, setError] = useState('');

  const loadResult = useCallback(
    async (page: number, pageSize: number, includeMarkdown: boolean) => {
      if (includeMarkdown) {
        setLoading(true);
      } else {
        setChunkLoading(true);
      }
      setError('');
      try {
        const nextResult = await getKnowledgeBuildResult({
          resourceId,
          filePath,
          chunkPage: page,
          chunkPageSize: pageSize,
          includeMarkdown,
        });
        setResult((previous) => {
          if (includeMarkdown || !previous) return nextResult;
          return {
            ...nextResult,
            markdown: {
              ...nextResult.markdown,
              data: previous.markdown?.data,
              characterCount: previous.markdown?.characterCount,
              byteCount: previous.markdown?.byteCount,
            },
          };
        });
      } catch (requestError: any) {
        setError(
          typeof requestError === 'string'
            ? requestError
            : requestError?.message || requestError?.msg || 'Failed to load build result'
        );
      } finally {
        setLoading(false);
        setChunkLoading(false);
      }
    },
    [filePath, resourceId]
  );

  useEffect(() => {
    void loadResult(1, 20, true);
  }, [loadResult]);

  return (
    <BuildResultView
      resourceId={resourceId}
      result={result}
      loading={loading}
      chunkLoading={chunkLoading}
      error={error}
      fallbackFileName={fileName}
      fallbackFilePath={filePath}
      onClose={onClose}
      onChunkPageChange={(page, pageSize) => void loadResult(page, pageSize, false)}
    />
  );
};

export default BuildResultPanel;
