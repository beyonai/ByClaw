import { getPublicationCapabilities } from '@/service/employeePublication';
import { useIntl, useLocation, useNavigate } from '@umijs/max';
import { useRequest } from 'ahooks';
import { Button, Result } from 'antd';
import type { ReactNode } from 'react';
import PublicationLoading from './Loading';

/** 发布链接先确认功能可用性；开源和商业版本均支持，普通编辑不受此请求影响。 */
export default function PublicationEditionGuard({ children }: { children: ReactNode }) {
  const intl = useIntl();
  const { search } = useLocation();
  const navigate = useNavigate();
  const publicationId = new URLSearchParams(search).get('publicationId');
  const { data, loading, error, refresh } = useRequest(getPublicationCapabilities, {
    ready: !!publicationId,
    refreshDeps: [publicationId],
  });
  if (!publicationId) return <>{children}</>;
  if (error) {
    return (
      <Result
        status="warning"
        title={intl.formatMessage({ id: 'employeePublication.guard.checkFailed' })}
        subTitle={intl.formatMessage({ id: 'employeePublication.guard.retryOrBack' })}
        extra={[
          <Button key="retry" type="primary" onClick={refresh}>
            {intl.formatMessage({ id: 'employeePublication.retry' })}
          </Button>,
          <Button key="back" onClick={() => navigate('/myEmployees')}>
            {intl.formatMessage({ id: 'employeePublication.backToEmployees' })}
          </Button>,
        ]}
      />
    );
  }
  if (loading)
    return (
      <PublicationLoading
        title={intl.formatMessage({ id: 'employeePublication.guard.opening' })}
        onBack={() => navigate('/myEmployees')}
      />
    );
  if (data?.enabled !== true) {
    return (
      <Result
        status="info"
        title={intl.formatMessage({ id: 'employeePublication.guard.unavailable' })}
        subTitle={intl.formatMessage({ id: 'employeePublication.guard.checkLogin' })}
        extra={
          <Button type="primary" onClick={() => navigate('/myEmployees')}>
            {intl.formatMessage({ id: 'employeePublication.backToEmployees' })}
          </Button>
        }
      />
    );
  }
  return <>{children}</>;
}
