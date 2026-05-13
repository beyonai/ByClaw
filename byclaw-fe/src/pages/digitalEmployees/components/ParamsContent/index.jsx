import { useIntl } from '@umijs/max';
import { Empty } from 'antd';
import styles from './index.module.less';

export default function ParamsContent({ fields = [] }) {
  const intl = useIntl();

  return (
    <div className={styles.paramsContent}>
      {!fields || fields.length === 0 ? (
        <Empty />
      ) : (
        fields.map((item, index) => (
          <div style={{ marginBottom: '8px' }} key={index}>
            <div>
              <span className={styles.fieldCode}>{item.fieldCode}</span>
              <span className={styles.fieldLabel}>{item.fieldLabel}</span>
              {item.isRequired === 1 && <span color="#FF5D5D">{intl.formatMessage({ id: 'form.required' })}</span>}
            </div>
            <div className={styles.fieldDesc}>{item.fieldDesc}</div>
          </div>
        ))
      )}
    </div>
  );
}
