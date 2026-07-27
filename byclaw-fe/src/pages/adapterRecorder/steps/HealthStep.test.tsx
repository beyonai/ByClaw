import {
  llmHealthStatus,
  llmSynthesisDescription,
  requiredHealthChecksPass,
  shouldShowLlmUnavailableAlert,
} from './HealthStep';

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

describe('health readiness', () => {
  it('requires all four mandatory checks but does not require an LLM', () => {
    expect(
      requiredHealthChecksPass({
        localService: 'ok',
        daemon: 'ok',
        extension: 'ok',
        highLevel: 'ok',
        llmSynthesis: false,
      })
    ).toBe(true);
  });

  it('blocks continuation when a mandatory check fails', () => {
    expect(
      requiredHealthChecksPass({
        localService: 'ok',
        daemon: 'down',
        extension: 'ok',
        highLevel: 'ok',
        llmSynthesis: true,
      })
    ).toBe(false);
  });

  it('reports the LLM as unchecked, available, or unavailable independently', () => {
    expect(llmHealthStatus()).toBe('未检查');
    expect(
      llmHealthStatus({ localService: 'ok', daemon: 'ok', extension: 'ok', highLevel: 'ok', llmSynthesis: true })
    ).toBe('可用');
    expect(
      llmHealthStatus({ localService: 'ok', daemon: 'ok', extension: 'ok', highLevel: 'ok', llmSynthesis: false })
    ).toBe('不可用');
  });

  it('shows the extra LLM notice only after an unavailable LLM check', () => {
    expect(shouldShowLlmUnavailableAlert()).toBe(false);
    expect(
      shouldShowLlmUnavailableAlert({
        localService: 'ok',
        daemon: 'ok',
        extension: 'ok',
        highLevel: 'ok',
        llmSynthesis: true,
      })
    ).toBe(false);
    expect(
      shouldShowLlmUnavailableAlert({
        localService: 'ok',
        daemon: 'ok',
        extension: 'ok',
        highLevel: 'ok',
        llmSynthesis: false,
      })
    ).toBe(true);
  });
});
