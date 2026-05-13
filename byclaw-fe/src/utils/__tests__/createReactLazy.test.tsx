import React, { Suspense } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import createReactLazy from '../createReactLazy';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <div>{this.state.error.message}</div>;
    }
    return this.props.children;
  }
}

describe('utils/createReactLazy', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('loads and renders lazy component, then calls onLoaded', async () => {
    const onLoaded = jest.fn();
    const lazy = createReactLazy(onLoaded);
    const importFn = jest.fn().mockResolvedValue({
      default: ({ text }: { text: string }) => <div>{text}</div>,
    });

    const LazyComp = lazy(importFn);

    render(
      <Suspense fallback={<div>loading</div>}>
        <LazyComp text="hello" />
      </Suspense>
    );

    expect(screen.getByText('loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('hello')).toBeInTheDocument());
    expect(onLoaded).toHaveBeenCalled();
  });

  it('renders error boundary content when lazy import fails', async () => {
    const lazy = createReactLazy(jest.fn());
    const importFn = jest.fn().mockRejectedValue(new Error('load failed'));
    const LazyComp = lazy(importFn);

    render(
      <ErrorBoundary>
        <Suspense fallback={<div>loading</div>}>
          <LazyComp />
        </Suspense>
      </ErrorBoundary>
    );

    await waitFor(() => expect(screen.getByText('load failed')).toBeInTheDocument());
  });
});
