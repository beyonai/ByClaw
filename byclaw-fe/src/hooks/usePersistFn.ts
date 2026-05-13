import { useRef, useMemo } from 'react';

function usePersistFn<T extends unknown[], R>(fn: (...params: T) => R) {
  if (typeof fn !== 'function') {
    console.error('param is not a function');
  }

  const fnRef = useRef(fn);
  fnRef.current = useMemo(() => fn, [fn]);

  const persistFn = useRef<any>();
  if (!persistFn.current) {
    persistFn.current = function (...args: any) {
      return fnRef.current.apply(this, args);
    };
  }

  return persistFn.current as (...params: T) => R;
}

export default usePersistFn;
