import { useEffect, useState } from 'react';
import { Alert, Descriptions, Drawer, Spin } from 'antd';
import { queryResourceDetail } from '@/pages/manager/service/resources';

/** Viewing grants only load the metadata endpoint, without members, package contents or knowledge previews. */
const ResourceBasicInfoDrawer = ({ resourceId, onClose }: { resourceId: string; onClose: () => void }) => {
  const [data, setData] = useState<any>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    setData(undefined);
    queryResourceDetail({ resourceId })
      .then((result) => {
        if (active) setData(result);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [resourceId]);
  return (
    <Drawer open title={data?.resourceName || '资源基础信息'} width={420} onClose={onClose}>
      <Spin spinning={loading}>
        {error ? (
          <Alert type="error" message="无法读取资源基础信息" />
        ) : (
          <Descriptions column={1}>
            <Descriptions.Item label="名称">{data?.resourceName}</Descriptions.Item>
            <Descriptions.Item label="介绍">{data?.resourceDesc}</Descriptions.Item>
            <Descriptions.Item label="类型">{data?.resourceBizType}</Descriptions.Item>
            <Descriptions.Item label="编码">{data?.resourceCode}</Descriptions.Item>
            <Descriptions.Item label="版本">{data?.resourceVersionId}</Descriptions.Item>
          </Descriptions>
        )}
      </Spin>
    </Drawer>
  );
};

export default ResourceBasicInfoDrawer;
