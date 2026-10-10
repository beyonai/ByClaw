import { useIntl } from '@umijs/max';
import { Button, Space, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';

export default function PublicationLoading({ title, onBack }: { title: string; onBack?: () => void }) {
  const intl = useIntl();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div role="status" aria-live="polite" aria-busy="true" style={{ padding: '40px 24px', textAlign: 'center' }}>
      <Space direction="vertical" size={16}>
        <Spin size="large" />
        <Typography.Text strong>{title}</Typography.Text>
        <Typography.Text type="secondary">
          {slow
            ? intl.formatMessage({ id: 'employeePublication.loading.slow' })
            : intl.formatMessage({ id: 'employeePublication.loading.wait' })}
        </Typography.Text>
        {onBack && (
          <Button onClick={onBack}>{intl.formatMessage({ id: 'employeePublication.backToEmployees' })}</Button>
        )}
      </Space>
    </div>
  );
}
