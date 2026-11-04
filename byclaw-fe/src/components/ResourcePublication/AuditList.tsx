import { publicationList, publicationSnapshot, type PublicationDetail } from '@/service/resourcePublication';
import { useIntl } from '@umijs/max';
import { Alert, Button, Segmented, Space, Table } from 'antd';
import { useEffect, useState } from 'react';
import { openResourcePublication } from './PublicationPanel';

export default function ResourcePublicationAuditList({
  resourceBizTypeList,
  onChange,
}: {
  resourceBizTypeList: string[];
  onChange?: () => void;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id: `rp.${id}` });
  const [review, setReview] = useState(true);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<PublicationDetail[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    publicationList({ review, page, size: 20, resourceBizTypeList })
      .then((data) => {
        if (active) {
          setRows(data.list);
          setTotal(data.total);
        }
      })
      .catch(() => {
        if (active) {
          setError(true);
          setRows([]);
          setTotal(0);
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [review, page, resourceBizTypeList, revision]);
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Segmented
        value={review ? 'review' : 'mine'}
        options={[
          { value: 'review', label: t('reviews') },
          { value: 'mine', label: t('mine') },
        ]}
        onChange={(v) => {
          setReview(v === 'review');
          setPage(1);
        }}
      />
      {error && (
        <Alert
          type="error"
          message={t('failed')}
          action={<Button onClick={() => setRevision((v) => v + 1)}>{t('reload')}</Button>}
        />
      )}
      <Table
        rowKey={(row) => row.publication!.requestId}
        loading={loading}
        dataSource={rows}
        pagination={{ current: page, pageSize: 20, total, onChange: setPage, showSizeChanger: false }}
        columns={[
          { title: t('resource'), render: (_, row) => publicationSnapshot(row).resourceName },
          { title: t('applicant'), render: (_, row) => row.publication?.applicantName },
          { title: t('result'), render: (_, row) => t(`status.${row.publication?.status}`) },
          {
            title: t('scope'),
            render: (_, row) =>
              row.targets
                .map((target) => `${target.target.orgNameSnapshot}: ${t(`status.${target.target.status}`)}`)
                .join('；'),
          },
          {
            title: t('actions'),
            render: (_, row) => (
              <Button
                type="link"
                onClick={() =>
                  openResourcePublication({
                    requestId: row.publication!.requestId,
                    onChange: () => {
                      setRevision((v) => v + 1);
                      onChange?.();
                    },
                  })
                }
              >
                {t('details')}
              </Button>
            ),
          },
        ]}
      />
    </Space>
  );
}
