import React, { useState, useEffect } from 'react';
import { Modal, Descriptions, Spin } from 'antd';
import { useIntl } from '@umijs/max';
import { queryResourceMembers } from '@/pages/manager/service/resources';
// import ResourceMembers from '../ResourceMembers';
import classnames from 'classnames';
import styles from './index.module.less';

interface IResourceItem {
  resourceCode?: string;
  resourceName: string;
  description?: string;
  resourceDesc?: string;
  resourceLogoUrl?: string;
  createUserName?: string;
  resourceBizType?: string;
  createTime?: number | string;
  resourceSourcePkId?: string;
  extInfo?: any;
}

interface ResourceDetailProps {
  visible: boolean;
  resourceId?: string | number;
  item: IResourceItem | null;
  resourceType: string;
  resourceName: string;
  onCancel: () => void;
  onEdit: () => void;
}

const ResourceDetail: React.FC<ResourceDetailProps> = ({ visible, resourceId, resourceName, item, onCancel }) => {
  const intl = useIntl();
  const [loading, setLoading] = useState(false);
  const [objectLoading, setObjectLoading] = useState(false);
  const [detailData, setDetailData] = useState<any>(null);
  const [selectedObject, setSelectedObject] = useState<any>(null);
  const [selectedObjectDetail, setSelectedObjectDetail] = useState<any>(null);

  // 处理关联对象点击
  const handleObjectClick = async (object: any) => {
    setSelectedObject(object);
    setObjectLoading(true);
    try {
      // 查询对象详情
      const objectDetail = await queryResourceMembers({ resourceId: object.resourceId });
      setSelectedObjectDetail(objectDetail);
    } catch (error) {
      console.error('Error fetching object detail:', error);
    } finally {
      setObjectLoading(false);
    }
  };

  // 查询资源详情
  useEffect(() => {
    const fetchResourceDetail = async () => {
      if (visible && resourceId) {
        setLoading(true);
        try {
          const data = await queryResourceMembers({ resourceId });
          setDetailData(data);
        } catch (error) {
          console.error('Error fetching resource detail:', error);
        } finally {
          setLoading(false);
        }
      }
    };

    fetchResourceDetail();
  }, [visible, resourceId]);

  // 当 detailData 变化时，自动选择第一个关联对象
  useEffect(() => {
    if (detailData) {
      try {
        const targetContent = detailData?.extInfo?.targetContent ? JSON.parse(detailData.extInfo.targetContent) : null;
        if (targetContent?.objects && targetContent.objects.length > 0) {
          // 选择第一个对象
          handleObjectClick(targetContent.objects[0]);
        }
      } catch (error) {
        console.error('Error parsing targetContent:', error);
      }
    }
  }, [detailData]);

  // 获取关联对象属性
  const getObjectProperties = () => {
    try {
      const targetContent = selectedObjectDetail?.extInfo?.targetContent
        ? JSON.parse(selectedObjectDetail.extInfo.targetContent)
        : null;
      return targetContent?.fields
        ? targetContent.fields.map((field: any) => field.propertyName).join('、')
        : Object.keys(selectedObject).join('、');
    } catch (error) {
      return Object.keys(selectedObject).join('、');
    }
  };

  // 获取属性信息
  const getPropertiesInfo = () => {
    try {
      const targetContent = detailData?.extInfo?.targetContent ? JSON.parse(detailData.extInfo.targetContent) : null;
      return targetContent?.fields ? (
        <Descriptions.Item label={`${resourceName}${intl.formatMessage({ id: 'resource.property' })}`} span={2}>
          <div className={styles.targetContent}>
            {targetContent.fields.map((field: any) => field.propertyName).join('、')}
          </div>
        </Descriptions.Item>
      ) : null;
    } catch (error) {
      return null;
    }
  };

  // 获取关联对象
  const getRelatedObjects = () => {
    try {
      const targetContent = detailData?.extInfo?.targetContent ? JSON.parse(detailData.extInfo.targetContent) : null;
      return targetContent?.objects && targetContent.objects.length > 0 ? (
        <Descriptions.Item label={intl.formatMessage({ id: 'resource.relatedObjects' })} span={2}>
          <div className={styles.targetContent}>
            <div className={styles.objectCardGrid}>
              {targetContent.objects.map((object: any, index: number) => (
                <div
                  key={index}
                  className={classnames(
                    styles.objectCard,
                    selectedObject?.resourceCode === object.resourceCode && styles.selectedObjectCard
                  )}
                  onClick={() => handleObjectClick(object)}
                >
                  <div className={styles.objectCardTitle}>{object.resourceName}</div>
                  <div className={styles.objectCardCode}>{object.resourceCode}</div>
                </div>
              ))}
            </div>
          </div>
        </Descriptions.Item>
      ) : null;
    } catch (error) {
      return null;
    }
  };

  return (
    <Modal
      title={`${resourceName}${intl.formatMessage({ id: 'common.detail' })}`}
      open={visible}
      onCancel={onCancel}
      width={1000}
      destroyOnHidden
      footer={null}
    >
      {loading ? (
        <div className={styles.loadingContainer}>
          <Spin size="large" />
        </div>
      ) : (
        <>
          <Descriptions bordered column={1} className={styles.descriptions}>
            <Descriptions.Item label={`${resourceName}${intl.formatMessage({ id: 'common.title' })}`}>
              {item?.resourceName}
            </Descriptions.Item>
            <Descriptions.Item label={`${resourceName}${intl.formatMessage({ id: 'common.code' })}`}>
              {item?.resourceCode}
            </Descriptions.Item>
            <Descriptions.Item label={`${resourceName}${intl.formatMessage({ id: 'common.description' })}`} span={2}>
              <div className={styles.descriptionContent}>{item?.resourceDesc || item?.description}</div>
            </Descriptions.Item>

            {getRelatedObjects()}

            {selectedObject && (
              <Descriptions.Item label={intl.formatMessage({ id: 'resource.relatedObjectProperties' })} span={2}>
                {objectLoading ? (
                  <div className={styles.loadingContainer}>
                    <Spin size="small" />
                  </div>
                ) : (
                  <div className={styles.targetContent}>{getObjectProperties()}</div>
                )}
              </Descriptions.Item>
            )}

            {getPropertiesInfo()}
          </Descriptions>
        </>
      )}
    </Modal>
  );
};

export default ResourceDetail;
