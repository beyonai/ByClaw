import { llmSynthesisDescription } from './HealthStep';

describe('llmSynthesisDescription', () => {
  it('explains a missing default-model credential without leaking configuration details', () => {
    expect(llmSynthesisDescription('default_model_token_missing')).toBe(
      '默认模型缺少服务端凭据；可继续使用本地规则流程。'
    );
  });
});
