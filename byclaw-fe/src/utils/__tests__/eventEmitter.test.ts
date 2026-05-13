import { EventEmitter$Cls } from '../eventEmitter';

describe('utils/eventEmitter', () => {
  let emitter: EventEmitter$Cls<any>;

  beforeEach(() => {
    emitter = new EventEmitter$Cls();
  });

  it('registers listeners with on and emits synchronously', () => {
    const handler = jest.fn();

    emitter.on('change', handler);
    emitter.emit('change', { value: 1 });

    expect(handler).toHaveBeenCalledWith({ value: 1 });
  });

  it('removes a specific listener with off', () => {
    const handler = jest.fn();

    emitter.on('change', handler);
    emitter.off('change', handler);
    emitter.emit('change', { value: 1 });

    expect(handler).not.toHaveBeenCalled();
  });

  it('removes all listeners for an event when off is called without handler', () => {
    const handlerA = jest.fn();
    const handlerB = jest.fn();

    emitter.on('change', handlerA);
    emitter.on('change', handlerB);
    emitter.off('change');
    emitter.emit('change', { value: 1 });

    expect(handlerA).not.toHaveBeenCalled();
    expect(handlerB).not.toHaveBeenCalled();
  });

  it('only fires a once listener a single time', () => {
    const handler = jest.fn();

    emitter.once('change', handler);
    emitter.emit('change', 1);
    emitter.emit('change', 2);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(1);
  });

  it('queues events emitted before listeners subscribe when waitForListeners is enabled', () => {
    const handler = jest.fn();

    emitter.emit('ready', { ok: true }, { waitForListeners: true });
    emitter.on('ready', handler);

    expect(handler).toHaveBeenCalledWith({ ok: true });
    expect(emitter.waitForListenerEvents).toEqual([]);
  });

  it('invoke resolves with all listener results', async () => {
    emitter.on('save', async (payload) => `a:${payload}`);
    emitter.on('save', async (payload) => `b:${payload}`);

    await expect(emitter.invoke('save', 'x')).resolves.toEqual([
      { status: 'fulfilled', value: 'a:x' },
      { status: 'fulfilled', value: 'b:x' },
    ]);
  });

  it('invoke resolves immediately when no listeners exist', async () => {
    await expect(emitter.invoke('missing', 'x')).resolves.toBeUndefined();
  });
});
