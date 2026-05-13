const mockIsDevelopment = jest.fn();

jest.mock('../common', () => ({
  isDevelopment: (...args: any[]) => mockIsDevelopment(...args),
}));

describe('utils/monitoring', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockIsDevelopment.mockReturnValue(false);
  });

  it('init binds global error and unhandledrejection listeners once', () => {
    const addEventListener = jest.spyOn(window, 'addEventListener');
    const { monitoring } = require('../monitoring');

    (monitoring as any).inited = false;
    monitoring.init();
    monitoring.init();

    expect(addEventListener).toHaveBeenCalledWith('error', expect.any(Function), true);
    expect(addEventListener).toHaveBeenCalledWith('unhandledrejection', expect.any(Function));
    expect(addEventListener).toHaveBeenCalledTimes(2);
  });

  it('captureException deduplicates repeated stack traces within one second', () => {
    const { monitoring } = require('../monitoring');
    const reportSpy = jest.spyOn(monitoring as any, 'reportToBackend').mockImplementation(() => {});
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    const error = new Error('boom');
    error.stack = 'same-stack';

    monitoring.captureException(error, 'RuntimeError');
    monitoring.captureException(error, 'RuntimeError');

    expect(reportSpy).toHaveBeenCalledTimes(1);
  });

  it('captureException reports again after dedupe window expires', () => {
    const { monitoring } = require('../monitoring');
    const reportSpy = jest.spyOn(monitoring as any, 'reportToBackend').mockImplementation(() => {});
    const error = new Error('boom');
    error.stack = 'same-stack';
    jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2500);

    monitoring.captureException(error, 'RuntimeError');
    monitoring.captureException(error, 'RuntimeError');

    expect(reportSpy).toHaveBeenCalledTimes(2);
  });

  it('serializeError handles Error, object and primitive values', () => {
    const { monitoring } = require('../monitoring');
    expect((monitoring as any).serializeError(new Error('boom'))).toMatchObject({
      name: 'Error',
      message: 'boom',
    });
    expect((monitoring as any).serializeError({ code: 1 })).toEqual({ code: 1 });
    expect((monitoring as any).serializeError('text')).toEqual({ message: 'text' });
  });

  it('global unhandledrejection listener ignores canceled errors and captures others', () => {
    const listeners: Record<string, Function> = {};
    jest.spyOn(window, 'addEventListener').mockImplementation(((type: string, cb: Function) => {
      listeners[type] = cb;
    }) as any);
    const { monitoring } = require('../monitoring');
    const captureSpy = jest.spyOn(monitoring, 'captureException');

    (monitoring as any).inited = false;
    monitoring.init();

    listeners.unhandledrejection({ reason: { name: 'CanceledError' } });
    listeners.unhandledrejection({ reason: new Error('boom') });

    expect(captureSpy).toHaveBeenCalledTimes(1);
    expect(captureSpy).toHaveBeenCalledWith(expect.any(Error), 'UnhandledRejection');
  });
});
