import type { PublicationDetail } from '@/service/employeePublication';
import { Alert, Button, Collapse, Modal, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import ResourceAvailabilityList from './ResourceAvailabilityList';

type Decision = 'publish' | 'edit' | 'cancel';

export default function usePublicationConfirmation() {
  const [candidate, setCandidate] = useState<PublicationDetail>();
  const resolveRef = useRef<(decision: Decision) => void>();
  useEffect(
    () => () => {
      resolveRef.current?.('cancel');
      resolveRef.current = undefined;
    },
    []
  );
  const settle = (decision: Decision) => {
    const resolve = resolveRef.current;
    resolveRef.current = undefined;
    setCandidate(undefined);
    resolve?.(decision);
  };
  const confirmPublication = (detail: PublicationDetail) => {
    if (resolveRef.current) return Promise.resolve<Decision>('cancel');
    setCandidate(detail);
    return new Promise<Decision>((resolve) => {
      resolveRef.current = resolve;
    });
  };
  const warnings = candidate?.dependencies.filter((dependency) => dependency.warning) || [];
  const others = candidate?.dependencies.filter((dependency) => !dependency.warning) || [];
  const noWarningsDescription = others.length
    ? '暂未发现需要提醒的关联资源。你可以展开下方清单查看详情。'
    : '这位员工暂未关联工具、知识或技能。';
  const confirmationDialog = (
    <Modal
      title="确认发布到官方推荐"
      open={!!candidate}
      width={760}
      style={{ maxWidth: 'calc(100vw - 32px)' }}
      styles={{ body: { maxHeight: '60vh', overflow: 'auto' } }}
      maskClosable={false}
      onCancel={() => settle('cancel')}
      footer={[
        <Button key="edit" onClick={() => settle('edit')}>
          返回修改
        </Button>,
        <Button key="publish" type="primary" onClick={() => settle('publish')}>
          继续发布
        </Button>,
      ]}
    >
      {candidate && (
        <>
          <Typography.Paragraph style={{ overflowWrap: 'anywhere' }}>
            <strong>{candidate.publication.employeeName}</strong>
            <br />
            <Typography.Text type="secondary">发布后，当前企业的所有成员都能使用这位数字员工。</Typography.Text>
          </Typography.Paragraph>
          <Alert
            showIcon
            type={warnings.length ? 'warning' : 'success'}
            style={{ marginBottom: 16 }}
            message={
              warnings.length ? `可以继续发布，有 ${warnings.length} 项资源需要留意` : '资源检查完成，可以继续发布'
            }
            description={
              warnings.length
                ? '这些资源不会阻止发布，但可能影响其他成员使用员工的部分能力。你可以继续发布，也可以返回修改关联资源。'
                : noWarningsDescription
            }
          />
          {warnings.length > 0 && <ResourceAvailabilityList dependencies={warnings} />}
          {others.length > 0 && (
            <Collapse
              key={candidate.publication.requestId}
              ghost
              style={{ marginTop: warnings.length ? 12 : 0 }}
              items={[
                {
                  key: 'others',
                  label: `查看${warnings.length ? '其余' : '关联'}资源（${others.length} 项，无使用限制提醒）`,
                  children: <ResourceAvailabilityList dependencies={others} />,
                },
              ]}
            />
          )}
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            配置已保存。继续后按现有规则提交审核或直接发布；返回修改不会提交。
            关联资源保留原有权限，可正常复制的个人技能会生成全员可用的副本。资源实际可用性以使用时的权限和状态为准。
          </Typography.Paragraph>
        </>
      )}
    </Modal>
  );
  return { confirmPublication, confirmationDialog };
}
