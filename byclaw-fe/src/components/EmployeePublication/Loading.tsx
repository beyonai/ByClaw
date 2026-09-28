import { Button, Space, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';

export default function PublicationLoading({ title, onBack }: { title: string; onBack?: () => void }) {
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
          {slow ? '加载时间比平时稍长，仍在处理中，请勿重复操作。' : '请稍候，完成后将自动显示。'}
        </Typography.Text>
        {onBack && <Button onClick={onBack}>返回员工列表</Button>}
      </Space>
    </div>
  );
}
