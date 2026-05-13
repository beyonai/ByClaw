import { CopyOutlined, DeleteOutlined } from '@ant-design/icons';
import { Button, Input, Segmented, Space, Spin, Table } from 'antd';
import React from 'react';
import type { IntlShape } from 'react-intl';
import styles from './ModelFormModal.module.less';
import type { DebugInputMode } from './modelFormUtils';

type Props = {
  intl: IntlShape;
  debugInputMode: DebugInputMode;
  debugInput: string;
  setDebugInput: (value: string) => void;
  debugOutput: string;
  setDebugOutput: (value: string) => void;
  debugOutputLoading: boolean;
  runDebug: () => void;
  copyText: (text: string, successMessageId: string) => void;
  shouldShowRerankTable: boolean;
  rerankView: 'table' | 'json';
  setRerankView: (value: 'table' | 'json') => void;
  rerankTableData: any[];
};

const ModelDebugPanel: React.FC<Props> = ({
  intl,
  debugInputMode,
  debugInput,
  setDebugInput,
  debugOutput,
  setDebugOutput,
  debugOutputLoading,
  runDebug,
  copyText,
  shouldShowRerankTable,
  rerankView,
  setRerankView,
  rerankTableData,
}) => {
  return (
    <div className={styles.debugPanel}>
      <div className={styles.debugHero}>
        <div className={styles.sectionTitle}>
          <span className={styles.sectionBar} />
          {intl.formatMessage({ id: 'modelMgr.modal.debugPanelTitle' })}
        </div>
        <div className={styles.sectionDesc}>{intl.formatMessage({ id: 'modelMgr.modal.debugPanelDesc' })}</div>
        <div className={styles.debugModeBadge}>
          {debugInputMode === 'auto'
            ? intl.formatMessage({ id: 'modelMgr.modal.debugModeAuto' })
            : intl.formatMessage({ id: 'modelMgr.modal.debugModeManual' })}
        </div>
      </div>

      <div className={styles.debugTips}>
        <div className={styles.debugTip}>{intl.formatMessage({ id: 'modelMgr.modal.debugTipSync' })}</div>
        <div className={styles.debugTip}>{intl.formatMessage({ id: 'modelMgr.modal.debugTipSave' })}</div>
      </div>

      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <div className={styles.codePanel}>
          <div className={styles.codePanelHeader}>
            <span>{intl.formatMessage({ id: 'modelMgr.modal.input' })}</span>
            <Space size={8}>
              <Button
                size="small"
                icon={<CopyOutlined />}
                onClick={() => copyText(debugInput, 'modelMgr.modal.copyInputSuccess')}
              >
                {intl.formatMessage({ id: 'common.copy' })}
              </Button>
              <Button size="small" type="primary" onClick={runDebug}>
                {intl.formatMessage({ id: 'modelMgr.modal.run' })}
              </Button>
            </Space>
          </div>
          <div className={styles.codeArea}>
            <Input.TextArea
              value={debugInput}
              onChange={(e) => setDebugInput(e.target.value)}
              autoSize={{ minRows: 12, maxRows: 12 }}
            />
          </div>
        </div>

        <div className={styles.codePanel}>
          <div className={styles.codePanelHeader}>
            <span>{intl.formatMessage({ id: 'modelMgr.modal.output' })}</span>
            <Space size={8}>
              {shouldShowRerankTable ? (
                <Segmented
                  size="small"
                  value={rerankView}
                  options={[
                    { label: '表格', value: 'table' },
                    { label: 'JSON', value: 'json' },
                  ]}
                  onChange={(val) => setRerankView(val as 'table' | 'json')}
                />
              ) : null}
              <Button
                size="small"
                icon={<CopyOutlined />}
                onClick={() => copyText(debugOutput, 'modelMgr.modal.copyOutputSuccess')}
              >
                {intl.formatMessage({ id: 'common.copy' })}
              </Button>
              <Button size="small" icon={<DeleteOutlined />} onClick={() => setDebugOutput('')}>
                {intl.formatMessage({ id: 'common.clear' })}
              </Button>
            </Space>
          </div>
          <div className={styles.codeArea} style={{ position: 'relative' }}>
            {debugOutputLoading ? (
              <div className={styles.outputLoading}>
                <Spin tip="请求中…" />
              </div>
            ) : null}
            {shouldShowRerankTable && rerankView === 'table' ? (
              <Table
                size="small"
                rowKey="__idx"
                pagination={false}
                dataSource={rerankTableData.map((it: any, index: number) => ({
                  ...it,
                  rank: index + 1,
                }))}
                columns={[
                  {
                    title: '排名',
                    dataIndex: 'rank',
                    width: 64,
                  },
                  {
                    title: '文本',
                    dataIndex: 'text',
                    ellipsis: true,
                  },
                  {
                    title: 'ID',
                    dataIndex: 'metadataId',
                    width: 72,
                  },
                  {
                    title: 'Score',
                    dataIndex: 'score',
                    width: 110,
                    align: 'right' as any,
                    render: (v: any) => {
                      const n = typeof v === 'number' ? v : Number(v);
                      if (Number.isNaN(n)) return '-';
                      return n.toFixed(6);
                    },
                  },
                ]}
              />
            ) : (
              <Input.TextArea
                value={debugOutput}
                onChange={(e) => setDebugOutput(e.target.value)}
                autoSize={{ minRows: 12, maxRows: 12 }}
                placeholder={intl.formatMessage({ id: 'modelMgr.modal.debugRunPlaceholder' })}
              />
            )}
          </div>
        </div>
      </Space>
    </div>
  );
};

export default ModelDebugPanel;
