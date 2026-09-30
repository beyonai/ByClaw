import type { PublicationDetail } from '@/service/employeePublication';
import { Alert, Button, Collapse, Modal, Typography } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import ResourceAvailabilityList, { resourceIsOmitted } from './ResourceAvailabilityList';
import UpdateTargetNotice from './UpdateTargetNotice';

type Decision = 'publish' | 'edit' | 'cancel';

export default function usePublicationConfirmation(mode: 'publish' | 'update' = 'publish') {
  const updating = mode === 'update';
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
  const confirmPublication = useCallback((detail: PublicationDetail) => {
    if (resolveRef.current) return Promise.resolve<Decision>('cancel');
    setCandidate(detail);
    return new Promise<Decision>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);
  const omitted = candidate?.dependencies.filter(resourceIsOmitted) || [];
  const retained = candidate?.dependencies.filter((dependency) => !resourceIsOmitted(dependency)) || [];
  const warnings = retained.filter((dependency) => dependency.warning);
  const others = retained.filter((dependency) => !dependency.warning);
  const noWarningsDescription = others.length
    ? '暂未发现需要提醒的关联资源。你可以展开下方清单查看详情。'
    : '这位员工暂未关联工具、知识或技能。';
  let summaryMessage = `资源检查完成，可以继续${updating ? '提交' : '发布'}`;
  let summaryDescription = noWarningsDescription;
  if (warnings.length) {
    summaryMessage = `可以继续${updating ? '提交' : '发布'}，有 ${warnings.length} 项资源需要留意`;
    summaryDescription =
      '这些资源不会阻止发布，但可能影响其他成员使用员工的部分能力。你可以继续发布，也可以返回修改关联资源。';
  }
  if (omitted.length) {
    summaryMessage = `发布后保留 ${retained.length} 项资源，${omitted.length} 项不会带入`;
    summaryDescription =
      '可以继续发布。系统会排除下方资源，它们及依赖它们的能力在企业员工中不可用；原个人员工保持不变。';
  }
  const confirmationDialog = (
    <Modal
      title={updating ? '确认提交员工更新' : '确认发布到官方推荐'}
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
        <Button
          key="publish"
          type="primary"
          disabled={candidate?.updateTarget?.changed}
          onClick={() => settle('publish')}
        >
          {updating ? '提交更新审核' : '确认并继续发布'}
        </Button>,
      ]}
    >
      {candidate && (
        <>
          <Typography.Paragraph style={{ overflowWrap: 'anywhere' }}>
            <strong>{candidate.publication.employeeName}</strong>
            <br />
            <Typography.Text type="secondary">
              {updating
                ? '审核通过后更新官方员工，审核期间大家继续使用当前版本。'
                : '发布后，当前企业的所有成员都能使用这位数字员工。'}
            </Typography.Text>
          </Typography.Paragraph>
          <UpdateTargetNotice detail={candidate} />
          <Alert
            showIcon
            type={omitted.length || warnings.length ? 'warning' : 'success'}
            style={{ marginBottom: 16 }}
            message={summaryMessage}
            description={summaryDescription}
          />
          {omitted.length > 0 && <ResourceAvailabilityList dependencies={omitted} />}
          {warnings.length > 0 && (
            <>
              <Typography.Paragraph strong style={{ marginTop: 16 }}>
                保留关联，但使用范围受限（{warnings.length} 项）
              </Typography.Paragraph>
              <ResourceAvailabilityList dependencies={warnings} />
            </>
          )}
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
            {updating
              ? '修改已存为更新草稿，提交后等待管理员审核；返回修改不会提交，也不会改变在用版本。'
              : '配置已保存。继续后按现有规则提交审核或直接发布；返回修改不会提交。'}
            只有清单中保留的资源会进入企业员工；通过校验的个人技能在审核通过后生成企业副本。已有企业资源沿用原权限。
          </Typography.Paragraph>
        </>
      )}
    </Modal>
  );
  return { confirmPublication, confirmationDialog };
}
