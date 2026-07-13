import React, { useState, useEffect } from 'react';
import { Button, Modal, Spin, Table } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { queryResourceMembers } from '@/pages/manager/service/resources';
// import ResourceMembers from '../ResourceMembers';
import classnames from 'classnames';
import dayjs from 'dayjs';
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
  useList?: ResourceMemberItem[];
  managerList?: ResourceMemberItem[];
  usedDigitalEmployees?: UsedDigitalEmployee[];
}

interface ResourceMemberItem {
  grantToObjName?: string;
  grantToObjId?: string | number;
}

interface UsedDigitalEmployee {
  resourceId?: string | number;
  resourceName?: string;
  useStartTime?: string | number;
}

interface ResourceDetailProps {
  visible: boolean;
  resourceId?: string | number;
  item: IResourceItem | null;
  resourceName: string;
  onCancel: () => void;
  onEdit: () => void;
  panel?: boolean;
}

const ResourceDetail: React.FC<ResourceDetailProps> = ({
  visible,
  resourceId,
  resourceName,
  item,
  onCancel,
  panel = false,
}) => {
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

  const renderDetailField = (label: React.ReactNode, value: React.ReactNode) => (
    <div className={styles.detailField}>
      <div className={styles.detailLabel}>{label}</div>
      <div className={styles.detailValue}>{value || '-'}</div>
    </div>
  );

  // 获取属性信息
  const getPropertiesInfo = () => {
    try {
      const targetContent = detailData?.extInfo?.targetContent ? JSON.parse(detailData.extInfo.targetContent) : null;
      if (!targetContent?.fields) {
        return null;
      }
      const content = (
        <div className={styles.targetContent}>
          {targetContent.fields.map((field: any) => field.propertyName).join('、')}
        </div>
      );
      return renderDetailField(`${resourceName}${intl.formatMessage({ id: 'resource.property' })}`, content);
    } catch (error) {
      return null;
    }
  };

  const renderMemberNames = (members?: ResourceMemberItem[]) => {
    const names = (Array.isArray(members) ? members : [])
      .map((member) => member.grantToObjName || member.grantToObjId)
      .filter(Boolean);

    return names.length ? names.join('、') : intl.formatMessage({ id: 'common.none' });
  };

  const formatDateTime = (value?: string | number) => {
    if (!value) return intl.formatMessage({ id: 'common.none' });
    const parsed = dayjs(value);
    // 使用开始日期只展示到分钟，避免秒级信息占用详情表格空间。
    return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm') : String(value);
  };

  const renderUsedDigitalEmployees = () => {
    const employees = Array.isArray(item?.usedDigitalEmployees) ? item?.usedDigitalEmployees : [];
    if (!employees.length) {
      return null;
    }

    return renderDetailField(
      intl.formatMessage({ id: 'skillDetail.usedDigitalEmployees' }),
      <Table
        size="small"
        pagination={false}
        columns={[
          {
            dataIndex: 'resourceName',
            title: intl.formatMessage({ id: 'skillDetail.digitalEmployeeName' }),
            render: (text: React.ReactNode) => text || intl.formatMessage({ id: 'common.none' }),
          },
          {
            dataIndex: 'useStartTime',
            title: intl.formatMessage({ id: 'skillDetail.useStartTime' }),
            // 日期只展示到分钟后收窄列宽，把更多横向空间留给数字员工名称。
            width: 150,
            render: (text: string | number) => formatDateTime(text),
          },
        ]}
        dataSource={employees.map((employee, index) => ({
          ...employee,
          key: employee.resourceId ?? index,
        }))}
      />
    );
  };

  // 获取关联对象
  const getRelatedObjects = () => {
    try {
      const targetContent = detailData?.extInfo?.targetContent ? JSON.parse(detailData.extInfo.targetContent) : null;
      if (!targetContent?.objects?.length) {
        return null;
      }
      const content = (
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
      );
      return renderDetailField(intl.formatMessage({ id: 'resource.relatedObjects' }), content);
    } catch (error) {
      return null;
    }
  };

  const title = `${resourceName}${intl.formatMessage({ id: 'common.detail' })}`;
  const detailContent = (
    <>
      {loading ? (
        <div className={styles.loadingContainer}>
          <Spin />
        </div>
      ) : (
        <div className={styles.detailFields}>
          {renderDetailField(`${resourceName}${intl.formatMessage({ id: 'common.title' })}`, item?.resourceName)}
          {renderDetailField(`${resourceName}${intl.formatMessage({ id: 'common.code' })}`, item?.resourceCode)}
          {renderDetailField(
            `${resourceName}${intl.formatMessage({ id: 'common.description' })}`,
            <div className={styles.descriptionContent}>{item?.resourceDesc || item?.description || '-'}</div>
          )}

          {getRelatedObjects()}

          {selectedObject &&
            renderDetailField(
              intl.formatMessage({ id: 'resource.relatedObjectProperties' }),
              objectLoading ? (
                <div className={styles.loadingContainer}>
                  <Spin size="small" />
                </div>
              ) : (
                <div className={styles.targetContent}>{getObjectProperties()}</div>
              )
            )}

          {getPropertiesInfo()}

          {renderDetailField(
            intl.formatMessage({ id: 'common.userPerson' }),
            <div className={styles.memberList}>{renderMemberNames(detailData?.useList || item?.useList)}</div>
          )}

          {renderDetailField(
            intl.formatMessage({ id: 'common.manager' }),
            <div className={styles.memberList}>{renderMemberNames(detailData?.managerList || item?.managerList)}</div>
          )}

          {renderUsedDigitalEmployees()}
        </div>
      )}
    </>
  );

  if (panel) {
    if (!visible) {
      return null;
    }

    return (
      <div className={styles.detailPanel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>{title}</span>
          <Button type="text" size="small" icon={<CloseOutlined />} onClick={onCancel} />
        </div>
        <div className={styles.panelBody}>{detailContent}</div>
      </div>
    );
  }

  return (
    <Modal title={title} open={visible} onCancel={onCancel} width={1000} destroyOnHidden footer={null}>
      {detailContent}
    </Modal>
  );
};

export default ResourceDetail;
