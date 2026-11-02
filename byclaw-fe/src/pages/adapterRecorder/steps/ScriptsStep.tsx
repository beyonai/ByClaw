import { useIntl } from '@umijs/max';
// 拆步③ 测试保存页:展示生成的脚本,每个脚本有「测试」(单草稿真 verify)和「保存」(单存)按钮。
// 可逐个测/存,保存后卡片标记已存,停留本页(不自动结束会话)。
import { useEffect, useState } from 'react';
import { CheckCircleFilled, ExperimentOutlined, SaveOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Space, Typography } from 'antd';
import type { PipelineDraft, SavedAdapter } from '../types/recorder';
import { DraftCard } from './pipelineShared';

const { Paragraph, Text } = Typography;

interface Props {
  loading: boolean;
  drafts?: PipelineDraft[];

  /** 每个草稿的「测试中」标记(draftId → verify 进行中)。 */
  draftVerifying?: Record<string, boolean>;

  /** 本次会话中成功保存过的草稿 id 集合；不代表文件此刻仍存在。 */
  savedDraftIds?: string[];

  /** 已保存 adapter 列表(展示路径)。 */
  savedAdapters?: SavedAdapter[];

  /** 单草稿测试(真 verify)。 */
  onVerifyDraft: (draftId: string, source?: string) => void;

  /** 单草稿保存(带可能编辑过的源码)。 */
  onSaveDraft: (draftId: string, source?: string) => void;

  /** 返回上一步(生成页)。 */
  onBack: () => void;
}

export default function ScriptsStep({
  loading,
  drafts,
  draftVerifying,
  savedDraftIds,
  savedAdapters,
  onVerifyDraft,
  onSaveDraft,
  onBack,
}: Props) {
  const intl = useIntl();
  // 每个草稿(可能编辑过的)源码,按 draft.id 索引。drafts 变化时按新 id 集重置。
  const [sources, setSources] = useState<Record<string, string>>({});
  const draftKey = (drafts ?? []).map((d) => d.id).join('|');
  useEffect(() => {
    setSources({});
  }, [draftKey]);

  const savedSet = new Set(savedDraftIds ?? []);
  const savedPath = savedAdapters?.[0]?.adapterPath;
  const relativeSavedPath = savedPath?.includes('.bycli/clis/')
    ? savedPath.slice(savedPath.indexOf('.bycli/clis/'))
    : '.bycli/clis/';

  if (!drafts?.length) {
    return (
      <Card title={intl.formatMessage({ id: 'adapterRecorder.scripts.title' })} variant="borderless">
        <Alert
          type="warning"
          showIcon
          message={intl.formatMessage({ id: 'adapterRecorder.scripts.empty' })}
          description={intl.formatMessage({ id: 'adapterRecorder.scripts.emptyHint' })}
        />
        <Button style={{ marginTop: 12 }} icon={<ArrowLeftOutlined />} onClick={onBack}>
          {intl.formatMessage({ id: 'projectSpace.onboarding.action.prev' })}
        </Button>
      </Card>
    );
  }

  return (
    <Card title={intl.formatMessage({ id: 'adapterRecorder.scripts.title' })} variant="borderless">
      <Paragraph type="secondary" style={{ lineHeight: 1.7 }}>
        {intl.formatMessage({ id: 'adapterRecorder.scripts.description' })}
      </Paragraph>

      {savedAdapters?.length ? (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 12 }}
          message={intl.formatMessage(
            { id: 'adapterRecorder.scripts.saved' },
            { v0: savedAdapters.length, v1: relativeSavedPath }
          )}
        />
      ) : null}

      {drafts.map((d) => {
        const source = sources[d.id] ?? d.source;
        const sourceChanged = source !== d.source;
        const displayedDraft = sourceChanged
          ? { ...d, usable: false, verifiedSourceHash: undefined, verifiedAt: undefined }
          : d;
        const verifying = !!draftVerifying?.[d.id];
        const saved = savedSet.has(d.id);
        return (
          <DraftCard
            key={d.id}
            draft={displayedDraft}
            source={source}
            onSourceChange={(src) => setSources((s) => ({ ...s, [d.id]: src }))}
            actions={
              <Space wrap>
                <Button
                  icon={<ExperimentOutlined />}
                  loading={verifying}
                  disabled={(loading && !verifying) || !d.filePath}
                  title={!d.filePath ? intl.formatMessage({ id: 'adapterRecorder.scripts.unavailable' }) : undefined}
                  onClick={() => onVerifyDraft(d.id, source)}
                >
                  {intl.formatMessage({ id: 'adapterRecorder.scripts.verify' })}
                </Button>
                <Button
                  type="primary"
                  icon={saved ? <CheckCircleFilled /> : <SaveOutlined />}
                  loading={loading && !verifying}
                  disabled={loading || sourceChanged || !d.usable}
                  title={
                    sourceChanged || !d.usable
                      ? intl.formatMessage({ id: 'adapterRecorder.scripts.reverifyHint' })
                      : undefined
                  }
                  onClick={() => onSaveDraft(d.id, source)}
                >
                  {saved
                    ? intl.formatMessage({ id: 'adapterRecorder.scripts.saveAgain' })
                    : intl.formatMessage({ id: 'common.save' })}
                </Button>
                {(sourceChanged || !d.usable) && !saved && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {sourceChanged
                      ? intl.formatMessage({ id: 'adapterRecorder.scripts.changedHint' })
                      : intl.formatMessage({ id: 'adapterRecorder.scripts.verifyFirst' })}
                  </Text>
                )}
              </Space>
            }
          />
        );
      })}

      <div style={{ marginTop: 12 }}>
        <Button icon={<ArrowLeftOutlined />} disabled={loading} onClick={onBack}>
          {intl.formatMessage({ id: 'adapterRecorder.scripts.previous' })}
        </Button>
      </div>
    </Card>
  );
}
