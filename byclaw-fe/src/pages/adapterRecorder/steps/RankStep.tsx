// Step 4 · 排序候选 —— rank 输出 RankCandidate[],候选卡列表 + 选定 + A 样本 trace 图
import { Button, Card, Col, Empty, Row, Typography } from 'antd';
import CandidateCard from '../components/CandidateCard';
import TraceChart from '../components/TraceChart';
import type { CaptureSample, RankCandidate } from '../types/recorder';

const { Paragraph } = Typography;

interface Props {
  loading: boolean;
  candidates?: RankCandidate[];
  selectedId?: string;
  sampleA?: CaptureSample;
  sampleB?: CaptureSample;
  onRank: () => void;
  onSelect: (id: string) => void;
}

export default function RankStep({ loading, candidates, selectedId, sampleA, sampleB, onRank, onSelect }: Props) {
  const ranked = !!candidates?.length;
  return (
    <Card title="排序候选 endpoint" variant="borderless">
      <Paragraph type="secondary" style={{ lineHeight: 1.6 }}>
        读取会话内已冻结的 A/B 样本,内部执行 normalize/rank/diff,输出候选 endpoint(含得分、置信度、风险与得分解释)。
        选定一个候选后即可生成 adapter 草稿。
      </Paragraph>

      <Button type="primary" loading={loading} disabled={ranked} onClick={onRank} style={{ marginBottom: 16 }}>
        {ranked ? '已排序' : '执行排序'}
      </Button>

      {ranked ? (
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={14}>
            <Row gutter={[12, 12]}>
              {candidates!.map((c) => (
                <Col xs={24} key={c.id}>
                  <CandidateCard candidate={c} selected={selectedId === c.id} onSelect={onSelect} />
                </Col>
              ))}
            </Row>
          </Col>
          <Col xs={24} lg={10}>
            <Card size="small" title="A/B 样本差异与候选关联">
              <TraceChart sampleA={sampleA} sampleB={sampleB} candidates={candidates} selectedId={selectedId} />
            </Card>
          </Col>
        </Row>
      ) : (
        !loading && <Empty description="尚未排序" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </Card>
  );
}
