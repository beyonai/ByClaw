// 拆步③ 测试保存页:展示生成的脚本,每个脚本有「测试」(单草稿真 verify)和「保存」(单存)按钮。
// 可逐个测/存,保存后卡片标记已存,停留本页(不自动结束会话)。
import { useEffect, useState } from 'react';
import { CheckCircleFilled, ExperimentOutlined, SaveOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Space, Tag, Typography } from 'antd';
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
  // 每个草稿(可能编辑过的)源码,按 draft.id 索引。drafts 变化时按新 id 集重置。
  const [sources, setSources] = useState<Record<string, string>>({});
  const draftKey = (drafts ?? []).map((d) => d.id).join('|');
  useEffect(() => {
    setSources({});
  }, [draftKey]);

  const savedSet = new Set(savedDraftIds ?? []);

  if (!drafts?.length) {
    return (
      <Card title="③ 测试并保存脚本" variant="borderless">
        <Alert type="warning" showIcon message="LLM 未产出可用脚本" description="可返回上一步重新生成,或返回重录。" />
        <Button style={{ marginTop: 12 }} icon={<ArrowLeftOutlined />} onClick={onBack}>
          上一步
        </Button>
      </Card>
    );
  }

  return (
    <Card title="③ 测试并保存脚本" variant="borderless">
      <Paragraph type="secondary" style={{ lineHeight: 1.7 }}>
        每个脚本可单独「测试」(真跑 verify,看抽到几行/几字段)与「保存」(写入 ~/.bycli/clis/)。可逐个测、逐个存;
        保存后可继续处理其他脚本，也可再次保存；再次保存时若文件仍存在会先询问是否覆盖。
      </Paragraph>

      {savedAdapters?.length ? (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 12 }}
          message={`已保存 ${savedAdapters.length} 个脚本到 ~/.bycli/clis/`}
          description={
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              {savedAdapters.map((a) => (
                <Text key={a.adapterPath ?? `${a.site}/${a.name}`} className="code" style={{ fontSize: 12 }}>
                  <Tag color="success" style={{ marginInlineEnd: 6 }}>
                    {a.site}/{a.name}
                  </Tag>
                  {a.adapterPath}
                </Text>
              ))}
            </Space>
          }
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
                  title={!d.filePath ? '无可测文件(静态检查未通过或写盘失败)' : undefined}
                  onClick={() => onVerifyDraft(d.id, source)}
                >
                  测试(verify)
                </Button>
                <Button
                  type="primary"
                  icon={saved ? <CheckCircleFilled /> : <SaveOutlined />}
                  loading={loading && !verifying}
                  disabled={loading || sourceChanged || !d.usable}
                  title={sourceChanged || !d.usable ? '源码已修改或尚未通过测试，请先重新测试' : undefined}
                  onClick={() => onSaveDraft(d.id, source)}
                >
                  {saved ? '再次保存' : '保存到 ~/.bycli/clis/'}
                </Button>
                {(sourceChanged || !d.usable) && !saved && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {sourceChanged ? '源码已修改，请重新测试后保存' : '请先测试通过再保存'}
                  </Text>
                )}
              </Space>
            }
          />
        );
      })}

      <div style={{ marginTop: 12 }}>
        <Button icon={<ArrowLeftOutlined />} disabled={loading} onClick={onBack}>
          上一步:重新生成
        </Button>
      </div>
    </Card>
  );
}
