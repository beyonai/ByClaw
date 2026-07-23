import { llmSynthesisDescription } from './HealthStep';

describe('llmSynthesisDescription', () => {
  it('explains a missing default-model credential without leaking configuration details', () => {
    expect(llmSynthesisDescription('default_model_token_missing')).toBe(
      '默认模型缺少服务端凭据；可继续使用本地规则流程。'
    );
  });

  it('distinguishes a default-model detail lookup failure', () => {
    expect(llmSynthesisDescription('default_model_detail_lookup_failed')).toBe(
      '默认模型详情查询失败；可继续使用本地规则流程。'
    );
  });
});
