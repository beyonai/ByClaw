import { pull } from 'lodash';

export type EventHandler<E = any> = (e: E) => void;

/* 这个就是事件的原型 */
class EventEmitter$Cls<E = any> {
  private events: Record<string, EventHandler<E>[]>;

  waitForListenerEvents: Array<{
    event: string;
    data?: any;
  }> = [];

  constructor() {
    this.events = {};
  }

  private getFns(event: string) {
    if (!this.events[event]) {
      this.events[event] = [];
    }

    return this.events[event];
  }

  public on<T = E>(event: string, cb: EventHandler<T>) {
    const fns = this.getFns(event);
    fns.push(cb as any);
    // 有些事件，可能emit先于on，因此需要检查waitForListenerEvents中是否存在该事件，如果存在，则立即执行cb
    for (let i = 0; i < this.waitForListenerEvents.length; i += 1) {
      const waitForListenerEvent = this.waitForListenerEvents[i];
      if (waitForListenerEvent.event === event) {
        cb(waitForListenerEvent.data);
        this.waitForListenerEvents.splice(i, 1);
        i -= 1;
      }
    }
  }

  public off(event: string, cb?: EventHandler<E>) {
    if (cb) {
      const fns = this.getFns(event);
      pull(fns, cb);
    } else {
      delete this.events[event];
    }
  }

  public once<T = E>(event: string, cb: EventHandler<T>) {
    const fn2: EventHandler<E> = (e) => {
      this.off(event, fn2);
      cb(e as any);
    };
    this.on(event, fn2);
  }

  /* 同步调用 */
  public emit<T = E>(
    event: string,
    data?: T,
    params?: {
      waitForListeners?: boolean;
    }
  ) {
    const fns = this.getFns(event);
    if (typeof params === 'object' && params !== null) {
      if (params.waitForListeners === true) {
        this.waitForListenerEvents.push({
          event,
          data,
        });
      }
    }
    for (let i = 0; i < fns.length; i += 1) {
      const fn = fns[i] as EventHandler<any>;

      fn(data);
    }
  }

  /* 可以异步调用，返回一个Promise */
  public invoke<T = E>(event: string, param?: T) {
    const fns = this.getFns(event);

    if (fns.length <= 0) return Promise.resolve();

    return Promise.allSettled(fns.map((fn: EventHandler<any>) => fn(param)));
  }
}

export { EventEmitter$Cls };

export default new EventEmitter$Cls();
