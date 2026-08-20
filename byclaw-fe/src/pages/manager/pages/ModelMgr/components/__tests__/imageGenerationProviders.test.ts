import {
  getImageGenerationProvider,
  getImageProviderFormValues,
  IMAGE_GENERATION_PROVIDER_OPTIONS,
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

  it('does not route non-MiniMax providers into the MiniMax-only manager debug endpoint', () => {
    expect(supportsManagerImageDebug('MINIMAX')).toBe(true);
    expect(supportsManagerImageDebug('OPENAI')).toBe(false);
    expect(supportsManagerImageDebug('VOLCENGINE')).toBe(false);
  });
});
