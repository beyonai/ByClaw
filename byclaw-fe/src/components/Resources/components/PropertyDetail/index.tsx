import React from 'react';
import { Button } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import styles from './index.module.less';

interface PropertyDetailItem {
  resourceId?: string | number;
  resourceName?: string;
  propertyName?: string;
  propertyCode?: string;
  propertyGroup?: string;
  dataType?: string;
}

interface PropertyDetailProps {
  item: PropertyDetailItem;
  onClose: () => void;
}

const formatDetailValue = (value?: React.ReactNode) => {
  if (value === undefined || value === null || value === '') {
    return '-';
  }
  return value;
};

const PropertyDetail: React.FC<PropertyDetailProps> = ({ item, onClose }) => {
  const intl = useIntl();
  const title = `${intl.formatMessage({ id: 'resource.property' })}${intl.formatMessage({ id: 'common.detail' })}`;
  const detailFields = [
    { label: intl.formatMessage({ id: 'resource.propertyName' }), value: item.propertyName || item.resourceName },
    { label: intl.formatMessage({ id: 'resource.propertyCode' }), value: item.propertyCode || item.resourceId },
    { label: intl.formatMessage({ id: 'resource.propertyGroup' }), value: item.propertyGroup },
    { label: intl.formatMessage({ id: 'resource.dataType' }), value: item.dataType },
  ];

  return (
    <div className={styles.detailPanel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>{title}</span>
        <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} />
      </div>
      <div className={styles.panelBody}>
        <div className={styles.detailFields}>
          {detailFields.map((field) => (
            <div key={field.label} className={styles.detailField}>
              <div className={styles.detailLabel}>{field.label}</div>
              <div className={styles.detailValue}>{formatDetailValue(field.value)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PropertyDetail;
