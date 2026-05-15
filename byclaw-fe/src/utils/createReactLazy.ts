import React, { useEffect } from 'react';

export default function createReactLazy(onLoaded: () => void) {
  function lazy<T extends React.ComponentType<any>>(
    importFn: () => Promise<{ default: T }>
  ): React.LazyExoticComponent<any> {
    const LazyComponent = React.lazy(async () => {
      const module = await importFn();
      const Component = module.default || module;

      function LoadedComponent<P extends React.Attributes = any>(props: P) {
        useEffect(() => {
          onLoaded();
        }, []);

        return React.createElement(Component, props);
      }

      return { default: LoadedComponent };
    });

    return LazyComponent;
  }
  return lazy;
}
