import { useIntl } from '@umijs/max';
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
  const intl = useIntl();
  const ranked = !!candidates?.length;
  return (
    <Card title={intl.formatMessage({ id: 'adapterRecorder.rank.title' })} variant="borderless">
      <Paragraph type="secondary" style={{ lineHeight: 1.6 }}>
        {intl.formatMessage({ id: 'adapterRecorder.rank.description' })}
      </Paragraph>

      <Button type="primary" loading={loading} disabled={ranked} onClick={onRank} style={{ marginBottom: 16 }}>
        {ranked
          ? intl.formatMessage({ id: 'adapterRecorder.rank.ranked' })
          : intl.formatMessage({ id: 'adapterRecorder.rank.run' })}
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
            <Card size="small" title={intl.formatMessage({ id: 'adapterRecorder.rank.comparison' })}>
              <TraceChart sampleA={sampleA} sampleB={sampleB} candidates={candidates} selectedId={selectedId} />
            </Card>
          </Col>
        </Row>
      ) : (
        !loading && (
          <Empty
            description={intl.formatMessage({ id: 'adapterRecorder.rank.pending' })}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )
      )}
    </Card>
  );
}
