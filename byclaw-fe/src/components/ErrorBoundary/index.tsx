import React from 'react';
import { Result, Button } from 'antd';
import { monitoring } from '@/utils/monitoring';
import { getIntl } from '@umijs/max';

type Props = {
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

type State = {
  hasError: boolean;
};

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  handleReload = () => {
    window.location.reload();
  };

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    monitoring.captureException(error, 'ReactErrorBoundary', { componentStack: errorInfo.componentStack });
  }

  render() {
    const { hasError } = this.state;
    const { children, fallback } = this.props;
    if (hasError) {
      if (fallback) return fallback;
      return (
        <Result
          status="error"
          title={getIntl().formatMessage({ id: 'common.systemError' })}
          // subTitle="请刷新页面或稍后重试"
          extra={
            <Button type="primary" onClick={this.handleReload}>
              {getIntl().formatMessage({ id: 'common.refreshPage' })}
            </Button>
          }
          style={{ paddingTop: 48 }}
        />
      );
    }
    return children;
  }
}
