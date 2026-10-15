import {
  getImageGenerationProvider,
  getImageProviderFormValues,
  IMAGE_GENERATION_PROVIDER_OPTIONS,
  resolveImageGenerationProviderName,
  supportsManagerImageDebug,
} from '../imageGenerationProviders';

describe('image generation provider catalog', () => {
  it('matches the OpenClaw native providers and the ByClaw Volcengine extension', () => {
    expect(IMAGE_GENERATION_PROVIDER_OPTIONS.map((item) => item.value)).toEqual([
      'COMFYUI',
      'DEEPINFRA',
      'FAL',
      'GOOGLE',
      'LITELLM',
      'MICROSOFT_FOUNDRY',
      'MINIMAX',
      'OPENAI',
      'OPENROUTER',
      'VYDRA',
      'XAI',
      'VOLCENGINE',
    ]);
  });

  it('uses the Ark image-generation contract when Volcengine is selected', () => {
    expect(getImageProviderFormValues('VOLCENGINE')).toEqual({
      providerName: 'VOLCENGINE',
      modelProtocol: 'VOLCENGINE_IMAGE',
      apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
      modelCode: 'doubao-seedream-5-0-260128',
    });
  });

  it('keeps MiniMax as the backwards-compatible default', () => {
    expect(getImageProviderFormValues()).toEqual({
      providerName: 'MINIMAX',
      modelProtocol: 'MINIMAX_IMAGE',
      apiEndpoint: 'https://api.minimaxi.com/v1/image_generation',
      modelCode: 'image-01',
    });
  });

  it('normalizes aliases but rejects unknown providers', () => {
    expect(getImageGenerationProvider('comfy')?.providerName).toBe('COMFYUI');
    expect(getImageGenerationProvider('doubao')?.providerName).toBe('VOLCENGINE');
    expect(getImageGenerationProvider('unknown')).toBeUndefined();
  });

  it('enables only the new explicit Volcengine protocol alongside existing MiniMax debug', () => {
    expect(supportsManagerImageDebug('MINIMAX')).toBe(true);
    expect(supportsManagerImageDebug('OPENAI')).toBe(false);
    expect(supportsManagerImageDebug('VOLCENGINE')).toBe(false);
    expect(supportsManagerImageDebug('VOLCENGINE', 'VOLCENGINE_IMAGE')).toBe(true);
    expect(supportsManagerImageDebug('OPENAI', 'VOLCENGINE_IMAGE')).toBe(false);
    expect(supportsManagerImageDebug('VOLCENGINE', 'OpenAI')).toBe(false);
    expect(supportsManagerImageDebug(undefined, 'VOLCENGINE_IMAGE')).toBe(true);
    expect(supportsManagerImageDebug(undefined, 'MINIMAX_IMAGE')).toBe(true);
    expect(supportsManagerImageDebug(undefined, 'UNKNOWN_IMAGE')).toBe(false);
    expect(supportsManagerImageDebug(undefined, 'OPENAI_IMAGE')).toBe(false);
  });

  it.each([
    ['COMFY_IMAGE', 'COMFYUI'],
    ['DEEPINFRA_IMAGE', 'DEEPINFRA'],
    ['FAL_IMAGE', 'FAL'],
    ['GOOGLE_IMAGE', 'GOOGLE'],
    ['LITELLM_IMAGE', 'LITELLM'],
    ['MICROSOFT_FOUNDRY_IMAGE', 'MICROSOFT_FOUNDRY'],
    ['MINIMAX_IMAGE', 'MINIMAX'],
    ['OPENAI_IMAGE', 'OPENAI'],
    ['OPENROUTER_IMAGE', 'OPENROUTER'],
    ['VYDRA_IMAGE', 'VYDRA'],
    ['XAI_IMAGE', 'XAI'],
    ['VOLCENGINE_IMAGE', 'VOLCENGINE'],
  ])('infers the missing provider from %s', (protocol, provider) => {
    expect(resolveImageGenerationProviderName(undefined, protocol)).toBe(provider);
    expect(resolveImageGenerationProviderName(' ', protocol)).toBe(provider);
  });

  it('preserves explicit providers and does not guess generic or unknown protocols', () => {
    expect(resolveImageGenerationProviderName('DOUBAO', 'VOLCENGINE_IMAGE')).toBe('DOUBAO');
    expect(resolveImageGenerationProviderName('custom-provider', 'VOLCENGINE_IMAGE')).toBe('custom-provider');
    expect(resolveImageGenerationProviderName('MINIMAX', 'VOLCENGINE_IMAGE')).toBe('MINIMAX');
    for (const protocol of [undefined, 'OpenAI', 'Qwen', 'OPENAI_COMPATIBLE_IMAGE', 'UNKNOWN_IMAGE']) {
      expect(resolveImageGenerationProviderName(undefined, protocol)).toBeUndefined();
    }
  });
});
