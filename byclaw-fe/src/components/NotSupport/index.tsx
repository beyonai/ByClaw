import React from 'react';
import { getIntl } from '@umijs/max';

function NotSupport() {
  return (
    <div style={{ color: 'var(--beyond-color-text-tertiary)', fontSize: '13px', padding: '4px' }}>
      {getIntl().formatMessage({ id: 'notSupport.message' })}
    </div>
  );
}

export default NotSupport;
