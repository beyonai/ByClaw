import { useEffect, useRef, useState, Dispatch, SetStateAction } from 'react';
import { get, set } from 'lodash';

/**
 * 简单的共享状态
 * - 支持`useValue`快速使用状态、更新状态
 */
function useSharedStateValue<TState extends { [K: string]: any }>(store: SharedState<TState, any>, key?: any): any {
  const ref = useRef(key || '*');
  ref.current = key;
  const [value, setValue] = useState(() => (ref.current !== '*' ? get(store['state'], ref.current) : store['state']));

  const update = useRef<Dispatch<SetStateAction<any>>>((arg) => {
    const currentValue = ref.current !== '*' ? get(store['state'], ref.current) : store['state'];
    const val = typeof arg === 'function' ? arg(currentValue) : arg;

    store.emit(`[${ref.current}]`, val);
  });

  useEffect(() => {
    store['on'](key || '*', setValue);

    return () => {
      store['off'](key || '*', setValue);
    };
  }, [key, store]);

  return [value, update.current];
}

export class SharedState<
  T extends { [K: string]: any } = Record<string, any>,
  M extends { [k: string]: CallableFunction } = Record<string, CallableFunction>
> {
  private state: T;

  private listeners: { [K: string]: CallableFunction[] } = {};

  effects: Partial<M>;

  constructor(initialState: T) {
    this.state = Object.assign({}, initialState);
    this.effects = Object.assign({});
  }

  private on(key: string, fn: CallableFunction) {
    this.listeners[key] = [...(this.listeners[key] || []), fn];
  }

  private off(key: string, fn: CallableFunction) {
    this.listeners[key] = this.listeners[key].filter((listener) => listener !== fn);
  }

  emit(key: string, ...args: any[]) {
    const [, k] = key.match(/^\[(.+)\]$/) ?? [];
    // 特别处理 - 更新值
    if (k) {
      if (k === '*') {
        this.state = Object.assign(this.state, args[0]);
      } else {
        this.state = set(this.state, k, args[0]);
      }
      const val = get(this.state, k);
      this.listeners[k]?.forEach((fn) => fn(val));
      return;
    }
    // 通用监听
    this.listeners[key]?.forEach((fn) => fn(...args));
  }

  /** 使用整体状态 */
  useValue(): [T, Dispatch<SetStateAction<T>>];

  /** 使用指定属性状态 - 支持链式属性 */
  useValue<K extends TS.Keys<T> = TS.Keys<T>>(key: K): [TS.Get<T, K>, Dispatch<SetStateAction<TS.Get<T, K>>>];

  useValue(key?: any): any {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useSharedStateValue(this, key);
  }
}
