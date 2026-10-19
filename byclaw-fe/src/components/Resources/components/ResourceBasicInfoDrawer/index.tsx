import { useIntl } from '@umijs/max';
import { useEffect, useState } from 'react';
import { Alert, Descriptions, Drawer, Spin } from 'antd';
import { queryResourceDetail } from '@/pages/manager/service/resources';

const RESOURCE_TYPE_MESSAGES: Record<string, string> = {
  SKILL: 'common.skill',
  SKILL_GROUP: 'resource.skillGroup',
  KG_DOC: 'resource.knowledge',
  KG_DB: 'resource.knowledge',
  KG_QA: 'resource.knowledge',
  KG_TERM: 'resource.knowledge',
  KG_CLOUD: 'resource.knowledge',
  MCP: 'resource.mcp',
  TOOLKIT: 'resource.toolkit',
  AGENT: 'resource.agent',
  TOOL: 'common.tool',
  DIG_EMPLOYEE: 'common.digitalEmployee',
};

/** Viewing grants only load the metadata endpoint, without members, package contents or knowledge previews. */
const ResourceBasicInfoDrawer = ({ resourceId, onClose }: { resourceId: string; onClose: () => void }) => {
  const intl = useIntl();
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
    <Drawer
      open
      title={data?.resourceName || intl.formatMessage({ id: 'resource.basicInfo.title' })}
      width={420}
      onClose={onClose}
    >
      <Spin spinning={loading}>
        {error ? (
          <Alert type="error" message={intl.formatMessage({ id: 'resource.basicInfo.loadFailed' })} />
        ) : (
          <Descriptions column={1}>
            <Descriptions.Item label={intl.formatMessage({ id: 'resource.basicInfo.name' })}>
              {data?.resourceName}
            </Descriptions.Item>
            <Descriptions.Item label={intl.formatMessage({ id: 'resource.basicInfo.introduction' })}>
              {data?.resourceDesc}
            </Descriptions.Item>
            <Descriptions.Item label={intl.formatMessage({ id: 'resource.basicInfo.type' })}>
              {RESOURCE_TYPE_MESSAGES[data?.resourceBizType]
                ? intl.formatMessage({ id: RESOURCE_TYPE_MESSAGES[data.resourceBizType] })
                : data?.resourceBizType}
            </Descriptions.Item>
            <Descriptions.Item label={intl.formatMessage({ id: 'resource.basicInfo.code' })}>
              {data?.resourceCode}
            </Descriptions.Item>
            <Descriptions.Item label={intl.formatMessage({ id: 'resource.basicInfo.version' })}>
              {data?.resourceVersionId}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Spin>
    </Drawer>
  );
};

export default ResourceBasicInfoDrawer;
