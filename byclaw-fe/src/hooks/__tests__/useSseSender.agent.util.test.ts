import { IFormStatus } from '../useSseSender/agent/typescript';
import { formatSSEDate } from '../useSseSender/agent/util';

describe('hooks/useSseSender/agent/util', () => {
  let consoleErrorSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it('formats form payloads and keeps extra fields in extParam', () => {
    const result = formatSSEDate(
      JSON.stringify({
        pluginAppId: 'app-1',
        pluginMachineId: 'machine-1',
        title: 'Form title',
        rule: [{ key: 'name' }],
        foo: 'bar',
      }),
      'step-1'
    );

    expect(result).toEqual({
      pluginAppId: 'app-1',
      pluginMachineId: 'machine-1',
      title: 'Form title',
      substance: [{ key: 'name' }],
      formStatus: IFormStatus.INIT,
      stepId: 'step-1',
      extParam: {
        foo: 'bar',
      },
    });
  });

  it('returns an empty object when the payload is not valid JSON', () => {
    expect(formatSSEDate('not-json')).toEqual({});
  });
});
