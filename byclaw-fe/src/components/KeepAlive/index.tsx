import React, { useRef, Suspense } from 'react';

export interface KeepAliveProps {
  active?: boolean;
  children: React.JSX.Element;
}

const Wrap: React.FC<KeepAliveProps> = ({ active, children }) => {
  const unblock = useRef<() => void>(null);
  if (active) {
    unblock.current?.();
    unblock.current = null;
  }
  if (!active) {
    throw new Promise<void>((resolve) => {
      unblock.current = resolve;
    });
  }

  return children;
};

export const KeepAlive: React.FC<KeepAliveProps> = ({ active, children }) => (
  <Suspense fallback={null}>
    <Wrap active={active}>{children}</Wrap>
  </Suspense>
);
