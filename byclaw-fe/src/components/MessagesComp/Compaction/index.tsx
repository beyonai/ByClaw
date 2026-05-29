import React from 'react';
import { useIntl } from '@umijs/max';
import DividerTips from '@/components/MessageList/components/DividerTips';

export default function Compaction() {
  const { formatMessage } = useIntl();

  return <DividerTips text={formatMessage({ id: 'compaction' })} style={{ marginBlock: 12 }} />;
}
