import { IFormStatus } from '../useSseSender/agent/typescript';

describe('hooks/useSseSender/agent/typescript', () => {
  it('exports the expected form status enum values', () => {
    expect(IFormStatus.INIT).toBe(0);
    expect(IFormStatus.LOADING).toBe(1);
    expect(IFormStatus.FINISH).toBe(2);
    expect(IFormStatus.DISABLED).toBe(3);
    expect(IFormStatus.ERROR).toBe(4);
  });
});
