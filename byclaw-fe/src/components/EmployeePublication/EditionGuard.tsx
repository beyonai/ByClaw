import { getPublicationCapabilities } from '@/service/employeePublication';
import { useLocation, useNavigate } from '@umijs/max';
import { useRequest } from 'ahooks';
import { Button, Result } from 'antd';
import type { ReactNode } from 'react';
import PublicationLoading from './Loading';

/** 旧链接也必须先确认版本，避免商业版挂载发布编辑器和发起详情请求。 */
export default function PublicationEditionGuard({ children }: { children: ReactNode }) {
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
        title="暂时无法确认发布功能是否可用"
        subTitle="请重试，或返回员工列表。"
        extra={[
          <Button key="retry" type="primary" onClick={refresh}>
            重试
          </Button>,
          <Button key="back" onClick={() => navigate('/myEmployees')}>
            返回员工列表
          </Button>,
        ]}
      />
    );
  }
  if (loading) return <PublicationLoading title="正在打开发布页面" onBack={() => navigate('/myEmployees')} />;
  if (data?.enabled !== true) {
    return (
      <Result
        status="info"
        title="当前版本不支持发布到官方推荐"
        subTitle="数字员工发布功能仅在开源版本提供。你仍可以返回列表使用已有员工。"
        extra={
          <Button type="primary" onClick={() => navigate('/myEmployees')}>
            返回员工列表
          </Button>
        }
      />
    );
  }
  return <>{children}</>;
}
